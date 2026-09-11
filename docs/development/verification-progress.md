# Verification implementation evidence

This records verified changes after the [starting baseline](library-improvement-baseline.md).
The root `library-improvement-plan.md` remains the full goal checklist.

**Current source status:** the implementation goal remains paused at the requested
library-only Part B checkpoint. Four cleanup passes, the structured review, and
the explicitly authorized pivot-search change passed full Node 24.6.0 verification.
The subsequent module split addresses the two recorded structural concerns; its
focused verification is recorded separately below. Commit/push remain pending. Consumer work remains
on hold; do not change jskit-ai, vibe64, or their seeds for now.
The unfinished 13-file jskit-ai migration is parked in this repository.
The [saved patch and manifest](pending-jskit-ai/README.md) preserve it for later
reconciliation. Those 13 edits have been removed from active jskit-ai source;
the paired results below are historical evidence for the captured migrated
source, not a claim that the unmigrated checkout accepts the new contract.




## 2026-09-11: Storage and include module boundaries

The two structural concerns from the review are addressed. The canonical plugin
is now 920 lines (previously 1,979), retaining registration and data-operation
entry points. `canonical-link-store.js` owns physical link queries, membership
mutations and inverse-version invalidation. `canonical-relationship-reader.js`
owns linkage, includes, field selection and resource links. Services receive
explicit API-level dependencies; each call supplies its context and transaction.
Descriptor/adapter lookups remain live, including after resource evolution.

The ordinary include graph owner is now 234 lines (previously 1,757). Separate
modules own query/visibility helpers, to-one loaders, to-many loaders and
identifier-only reads. Loaders receive nested traversal as a callback, avoiding
imports back into the graph owner. All existing direct callers and direct-import
tests use the new owners; no forwarding barrel was added. The public plugin and
resource API remains unchanged. The [storage map](storage-boundaries.md#module-responsibilities)
describes the resulting layout.

Source review compared parsed function bodies with the pre-split copies:
24 include functions match after accounting for callback wiring; 40 canonical
functions match after accounting for moved dependencies and direct ID helpers.
The remaining reviewed changes expose API explicitly to the query-field lookup,
remove two forwarding functions and delegate link cleanup from `dataDelete`.
Cleanup retains the descriptor and ID captured by that delete operation.
The 102-file runtime import graph has no static relative-import cycles.

Node 24.6.0 verification:

- Initial relationship/visibility/version/include suites: 370 tests passed per
  SQLite storage adapter (740 total).
- Additional mapping, descriptor failure/evolution, visibility and batching
  suites: 287 ordinary and 312 canonical passed (599 total).
- Type checking, scoped lint, both query-budget checks and docs build passed.
- Packed public types/content passed: 161 files, 423,860 packed bytes, 233 local
  documentation links, 27 runtime exports and 10 negative checks; SHA-1
  `a3ebe861c1ea50da4264e9b08536e561afb3aa40`.
- PostgreSQL 16 and MySQL 8 each passed 162 ordinary and 162 canonical tests
  (648 native passes). Both runners exited successfully and removed their
  disposable database directories.

**Total for this split: 1,987 focused runtime tests passed, zero failures or
skips.** Source hashes were unchanged after the final review.

Local temporary evidence uses `/tmp/module-split-*.log`. Initial native attempts
could not start with the default server paths; the existing extracted PostgreSQL
16/MySQL 8 binaries were then selected explicitly. No system services or consumer
databases were changed. The complete 12,989-pass gate below predates this module
split; it was not repeated, following the requested lower frequency of full runs.
Checklist counts remain 138/214 complete; consumer work and commit/push remain
paused/pending as before.

## 2026-09-11: Structured maintainability review

**Complete verification before the module split:** `npm run verify` completed successfully on Node 24.6.0
against the final cleanup and explicit-search change. Ordinary SQLite:
5,958 passed and one existing skip; canonical SQLite: 6,025 passed; Express 4:
502 ordinary and 504 canonical passed. **12,989 passed, zero failures, one skip.**
Type checking, packed public types/content, both query budgets, repository lint
and the docs build also passed. The package check reported 155 files, 421,930
packed bytes, 233 local documentation links, 27 runtime exports and 10 negative
checks; SHA-1 `fa850b0e8d52fe792161675403a4141ca966375f`.
Log: `/tmp/json-rest-api-explicit-search-verify.log`. Runtime, test, type, script
and manifest hashes were unchanged during verification. Native database/Redis
checks and consumer workflows were not rerun by this cleanup gate.

The explicit-search regression failed in two cases before removing the heuristic:
omitted search and `search: false` both unexpectedly generated public filters.
All eight new cases now pass on each storage adapter, including explicit field
and `searchSchema` filters and relationship add/read/replace/remove operations.
The selected schema/search/version suites passed 82 ordinary and 98 canonical
tests before the complete gate. The new fixture option is test-only.
The [API migration guide](../GUIDE/MIGRATING_API_V2.md#declare-searchable-relationship-fields-explicitly)
explains how to declare filters; no database migration or consumer edits were made.

The earlier comprehensive structural-review run was stopped when the maintainer
authorized this behavior change. The final successful run above supersedes it
and the deferred-verification notes in the earlier cleanup entries below.

Scope: inventory and static relative-import graph of all 96 runtime files under
`lib/` and `plugins/`, cross-file repeated-block scan, and source review of resource
execution, schema compilation, query/include handling, both storage plugins,
HTTP connectors, transactions, bulk operations, file handling, and Socket.IO.
This is a maintainability review, not proof of absence of bugs or a line-by-line
security audit. Positioning and consumer changes remain outside the authorized scope.

Findings, ranked by maintenance impact:

| Impact | Finding | Resolution |
| --- | --- | --- |
| Medium | PUT and PATCH duplicated the full document/path ID validation sequence, including error construction and context updates. | Both now call `validateUpdateRequest` in the existing request-contract owner, at the same lifecycle point. |
| Medium | HTTP precondition code imported the broad resource-method `common.js` just to lock a parent row. | Moved parent locking beside target locking in `writing/relationship-processor.js`; all callers import that owner directly. No compatibility forwarding export. |
| Medium, resolved | The canonical storage plugin combined registration, descriptor access, link mutation, includes and data helpers in a roughly 2,000-line installation closure. | Extracted canonical link storage and relationship reading into API-scoped services with explicit dependencies. The plugin retains registration and data-operation entry points. |
| Medium, resolved | The relationship include module combined cardinality-specific loaders with traversal and output assembly in roughly 1,750 lines. | Split query/visibility helpers, to-one loaders, to-many loaders and identifier reads from the graph owner. Loaders retain their own query semantics and receive nested traversal explicitly. |
| Medium | `compile-schemas.js` inferred pivot resources from the proportion of belongs-to fields and enabled search, even overriding `search: false`. | Removed following the maintainer's explicit instruction to change this behavior. Search now follows field/search-schema declarations and enrichment hooks. The API migration guide explains the change. |
| Low | `cascadeConfig` exposed a generic multiple-source abstraction although all five callers supplied one source. | Removed; callers use direct nullish defaults. |
| Low | The root entry point repeated named error exports before exporting the same module with `export *`, describing it as compatibility code. | Removed the redundant export list and unimplemented Koa comment. All 27 root export names and values are identical. |

The static relative-import scan found no cycles. Similar resource hook sequences,
ordinary/canonical query setup, response refresh and transaction completion were
reviewed and retained where operation order or storage semantics differ. The
existing [write lifecycle](write-lifecycle.md) now maps the shared owners and
states the context mutation performed by the update contract helper. Large files,
mutable operation context and incomplete runtime type coverage remain reasons to
avoid claiming the library is universally simple or “fully clean.”

Focused verification on Node 24.6.0: **1,089 tests passed per storage adapter
(2,178 total), with no failures or skips**. Suites cover IDs, PUT creation,
lifecycle order, HTTP preconditions, versioned relationships, relationship
contracts and response formats. Type checking and scoped lint passed. A module
namespace comparison verified all 27 public export names and values. Local logs:
`/tmp/json-rest-api-structural-{knex,anyapi,types,lint}.log`.

## 2026-09-11: Cleanup and readability passes

The fourth pass expands the conditional HTTP transaction branch, separates response
body selection from 204 handling, makes primary-record indexing order explicit,
and names the output column and qualified column in field selection. It adds no
new abstraction or API. On Node 24.6.0, the selected HTTP validator, response
replacement, plain include, computed selection, query-field runtime, projection
diagnostic and linkage projection suites passed **144 tests per storage adapter
(288 total), with no failures or skips**. Type checking, ESLint on the three changed
runtime files, and `git diff --check` passed. Local temporary logs are
`/tmp/json-rest-api-deslop-fourth-{knex,anyapi,types,lint}.log`.
The comprehensive gate remains deferred; no consumer files were changed.

The first two passes removed unused injected dependencies and internal constants,
an empty Express release hook, forwarding wrappers, duplicated included-resource
enrichment, and repetitive comments. They also simplified the Node 24 CI setup
and removed stale migration-guide progress claims while retaining its fenced examples.
Focused runtime checks, type checks, lint, and packed migration-example checks
passed during those passes. These results do not constitute a completed final gate.

The third pass prioritizes readability over fewer lines: explicit transaction
outcomes and cleanup blocks, ordinary loops for version-update bindings and
reference fields, clear adapter fallback and relationship lookup branches, and
an explicit file-backend exception when copying resource configuration.
Transaction ownership, dependency traversal, cycle tracking, and ordered version
updates remain in place. No consumer repository or seed changes were made.

Node 24.6.0 verification of the third pass:

- Selected transaction, write-error, inverse-version, versioned-relationship,
  reverse-membership, storage-boundary and configuration-lifetime suites:
  **161 ordinary-table tests and 164 canonical-storage tests passed; no failures
  or skips**.
- `npm run typecheck`, ESLint on the five files changed in this pass, and
  `git diff --check` passed.
- Logs: `/tmp/json-rest-api-deslop-third-knex.log`,
  `/tmp/json-rest-api-deslop-third-anyapi.log`,
  `/tmp/json-rest-api-deslop-third-types.log`, and
  `/tmp/json-rest-api-deslop-third-lint.log` (local, temporary evidence).

Two comprehensive verification attempts were stopped at the maintainer's request
for another cleanup pass. Neither is recorded as a completed cleanup gate. The
complete verification below predates cleanup. Run final comprehensive verification
before committing/pushing; consumer work remains paused. Counts remain
**138/214 complete; 76 open**, including **35/48 Part B items complete**.

## 2026-09-11: Library-only Part B pause checkpoint

**138/214 complete (64.5%); 76 open. Part B: 35/48 complete, 13 open.**
The maintainer explicitly selected library-only Part B with consumers paused.
The remaining-work split now reconciles the library portions of every open B
item. Dynamic-call and packed migration-example acceptance are recorded in the
local migration audit. No consumer, seed or upstream dependency was changed.

The accumulated Node 24 `npm run verify` checkpoint completed successfully
(`/tmp/library-registration-selection-checkpoint.log`, session 33347, exit 0):

| Invocation | Passed | Failed | Skipped |
| --- | --- | --- | --- |
| Full ordinary SQLite | 5,950 | 0 | 1 |
| Full canonical SQLite | 6,017 | 0 | 0 |
| Express 4 ordinary | 502 | 0 | 0 |
| Express 4 canonical | 504 | 0 | 0 |
| Total | 12,973 | 0 | 1 |

Internal types, packed public types/content, both query-budget invocations,
lint and docs pass. Runtime/test files were held steady throughout the run.
The packed check contains 155 files, 437,412 packed bytes, 232 local documentation
links, 27 runtime exports and 10 negative declaration checks; SHA1
`a7ec49f3c57c8706a9e9d9db2422a135daf8d159`.
The separate packed migration probe also exits 0 (session 84801), executing both
SQLite modes plus the mapped-ID/generated-schema example against that artifact.
Expected missing-audit-table diagnostics exercise rollback assertions.

This run covers the accumulated changes through the iterative dependency sort.
Native SQL and Redis evidence remains separately scoped; no new native/Redis
matrix or consumer verification is claimed. Final pause-record Markdown changes
pass the separate documentation build (`/tmp/library-part-b-pause-docs.log`,
session 27416, exit 0). Diff whitespace checks and the 214-item recount pass.

Work stops here before the requested broad cleanup and commit/push. Twelve open
B items require consumer acceptance; B0-08 retains the explicitly paused
positioning example. B1 guarantees retain the documented hooked-api 1.0.24
limitations; the parked patch is not installed. No checkbox is closed by
reclassifying these exceptions, and the full goal is not marked complete.


## 2026-09-11: Deep dependency graphs do not exhaust the call stack

**138/214 complete; 76 open.** A valid 12,000-field chain reproduced
`Maximum call stack size exceeded` in the recursive sorter. Replaced recursive
visits with explicit iterator frames, preserving depth-first output and lazy
dependency iteration. Original graph/iterator failures remain primary while
open parent iterators are closed in reverse traversal order.

The deep valid graph now sorts, and its cyclic variant reports `field100`.
The 200-field membership counter remains 400 reads. New lazy-order, cleanup
and iterator-next failure tests pass against both the old recursive body
(loaded by a temporary probe) and the final implementation. Node 24 dependency,
getter and setter suites pass **91 ordinary + 87 canonical = 178 executions**;
the final five direct tests pass. Type checking and focused lint pass.
Logs: `/tmp/library-dependency-depth-before.log`,
`/tmp/library-dependency-depth-{knex,anyapi}.log`,
`/tmp/library-dependency-depth-original-semantics.log`,
`/tmp/library-dependency-depth-final.log`, `/tmp/library-dependency-depth-types.log`,
`/tmp/library-dependency-depth-lint-final.log`.

This is an in-memory graph-depth guarantee, not a database-column limit change.
The measurement reference records that distinction. A5/A8/A9 remain open.
The accumulated registration, selection and dependency changes now warrant one
comprehensive Node 24 checkpoint; its result must be recorded separately and
is not implied by the focused evidence above. Consumer repositories stay paused.

## 2026-09-11: Dependency compilation avoids repeated membership scans

**138/214 complete; 76 open.** Dependency sorting now builds a local membership
set once instead of scanning the entire field list for each edge. The existing
depth-first traversal, ordering, duplicate handling and cycle/unknown-dependency
errors remain. No retained cache or new schema representation was added.

The 200-field chain regression measured **20,100 indexed name reads before and
400 after**, with identical output. The old source fails only the work bound.
The additional direct case checks duplicate roots, shared dependencies and both
invalid-graph errors. Node 24 dependency/getter/setter suites pass
**88 ordinary + 87 canonical = 175 executions**. The final two direct tests also pass and
print the 400-read observation. Type checking and focused lint pass.
Logs: `/tmp/library-dependency-membership-before.log`,
`/tmp/library-dependency-membership-{knex,anyapi}.log`,
`/tmp/library-dependency-membership-final.log`,
`/tmp/library-dependency-membership-types.log`,
`/tmp/library-dependency-membership-lint.log`.

The measurement reference distinguishes reduced compilation metadata work from
SQL, timing or throughput claims. Long repetitive sort commentary was replaced
by the fixed-graph/order contract and generic signature; the schema-helper
implementation file remains unchecked. A5/A8's broader acceptance remains open.
No full/native or package gate was repeated, and no consumer files changed.
Final focused lint, documentation and whitespace checks pass
(`/tmp/library-dependency-membership-lint-final.log`,
`/tmp/library-dependency-membership-docs.log`).

## 2026-09-11: Explicit SQL aliases preserve translated expressions

**138/214 complete; 76 open.** Review of the newly checked SELECT builder found
that explicit aliases interpolated non-string translation results into text.
The raw case produced an incorrectly quoted expression with its binding already
inlined; the mapped case selected an identifier named `[object Object]`.
Both SQLite SQL-compilation regressions failed before the fix.

The alias branch now hands Knex a named expression, reusing the existing
immediate-expression predicate from projection handling. A single-entry
translation map is renamed structurally; empty/multi-entry maps reject clearly
instead of choosing an expression arbitrarily. String translation and wildcard
fallback retain their existing paths. This is an internal SQL helper correction,
not a new public fieldset syntax or relationship API.

Node 24 type checking passes. Related selection/dependency suites pass
**164 ordinary + 161 canonical = 325 executions**. The final direct suite
passes nine tests: raw/mapped alias SQL and binding preservation for SQLite,
PostgreSQL and MySQL Knex clients, two ambiguous-map rejections, and existing
wildcard/string-alias behavior. Those dialect checks compile SQL without a
connection; they are not claimed as native database execution.
Logs: `/tmp/library-select-alias-before.log`, `/tmp/library-select-alias-types.log`,
`/tmp/library-select-alias-{knex,anyapi}.log`, `/tmp/library-select-alias-final.log`.
The broad A9/query audit remains open. No comprehensive or native suite was run;
the last packed checkpoint predates this fix. Consumer repositories are unchanged.
Focused lint, documentation and whitespace checks pass
(`/tmp/library-select-alias-lint-final.log`, `/tmp/library-select-alias-docs.log`).

## 2026-09-11: Query selection implementation under strict checking

**138/214 complete; 76 open.** The existing `buildQuerySelection` implementation
now opts into strict checking. Nullable/absent translator results are typed as
the fallback signals the body already accepts. Field arrays retain readonly
inputs, and the return remains the caller's unexecuted storage query.

Five negative type cases cover executed rows, numeric names, async translators,
unchecked nullable aliases and literal data used as an SQL mapping. A direct
Knex test verifies unchanged builder identity, wildcard fallback, string alias
translation, raw expressions, mapped expressions and bindings, with no SQL
execution. The adjacent projection/computed checks also pass: **five focused
runtime tests total**. Node 24 type checking and focused lint pass.
Logs: `/tmp/library-query-selection-types-final.log`,
`/tmp/library-query-selection-runtime.log`, `/tmp/library-query-selection-lint.log`.

This extends the checked field-selection boundary; it does not claim every
query helper or possible translator/alias combination is verified. A9 remains
open. No comprehensive/native suite or package rerun was needed for this
implementation opt-in; the last packed checkpoint predates these annotations.
Documentation and whitespace checks pass (`/tmp/library-query-selection-docs.log`).

## 2026-09-11: Field selection bodies under strict checking

**138/214 complete; 76 open.** The full `knex-field-helpers.js` body is now
checked, using `field-selection-types.d.ts` composed from existing resource,
storage and projection types. Seven negative fixtures cover readonly requested
fieldsets, missing resource identity, absent-field results, executed rows passed
as builders, an incorrectly thenable result wrapper, non-string dependencies
and numeric computed-field names.

Checking corrected two inaccurate boundaries: requested fieldsets can be
readonly, and selection translators receive a null alias without table
prefixing. Missing fields still yield undefined from `isNonDatabaseField`.
Virtual selection retains the definitions from its initial scan instead of
looking them up again. Default computed selection uses entries; sparse selection
still performs no full metadata scan and reads only requested definitions. An
undefined compiled computed entry now rejects explicitly rather than failing
through property access. No new schema cache or runtime context hierarchy exists.

The existing dependency-closure and query-selection signatures now describe
their inputs/outputs, but those implementation files remain unchecked. Replaced
long stale selection comments with the logical-ID, visibility, dependency and
unexecuted-query invariants. No SQL execution or transaction ownership changed.

Node 24 type checking and focused lint pass. Fieldsets, dependencies, linkage
projections and direct selection tests pass **171 ordinary + 168 canonical =
339 executions**, including the existing zero-enumeration/one-definition sparse
selection counter. Logs: `/tmp/library-field-selection-types-final.log`,
`/tmp/library-field-selection-lint.log`,
`/tmp/library-field-selection-{knex,anyapi}.log`.
Packed public types/content pass: **155 files, 437,314 packed bytes, 232 local
documentation links, 27 runtime exports and 10 negative checks**;
SHA1 `0aaf2a35ca17fa279e61829e35b99f6a3dbd73fc`
(`/tmp/library-field-selection-package.log`). The wider A9 and A10 items remain
open; no full/native suite or consumer migration was run for this batch.
The documentation build and whitespace check pass
(`/tmp/library-field-selection-docs.log`).

## 2026-09-11: Projection helpers under strict checking

**138/214 complete; 76 open.** The full `query-field-helpers.js` body now opts
into strict checking. `query-field-types.d.ts` describes declarations, compiled
fields, selector context, SQL expressions and runtime bindings using existing
storage types. Bindings remain unknown, optional database/context handles stay
optional, and query-builder result shapes are not assumed to be ordinary rows.

Eight negative type cases cover missing compilation context, scalar selector
results, async builder/raw selectors, unchecked optional database access,
uncompiled runtime fields, non-string names and assumed string bindings.
The existing immediate-expression branch is expressed as a type guard using
the same object/property test; it does not add a proxy `has` trap or await a
builder. A runtime test verifies builder identity, raw bindings, duplicate
selection elimination and zero executed SQL, including a proxy that rejects
property-presence probes.

An initial new test incorrectly returned a Knex raw value from an async
callback and attempted a database connection: raw values are thenable too.
The final positive test uses synchronous selectors, and negative type fixtures
cover this mistake for both builders and raw values. The projection guide now
states the direct-return requirement. The runtime's existing rejection handling
for unchecked async callers remains; no async execution guarantee is invented.

Node 24 type checking and focused lint pass. Projection runtime/linkage/diagnostic
checks pass **12 ordinary + 11 canonical = 23 executions**. Logs:
`/tmp/library-projection-types-final.log`, `/tmp/library-projection-lint.log`,
`/tmp/library-projection-runtime-{knex,anyapi}.log`.
The packed-package check passes: **154 files, 437,956 packed bytes, 232 local
documentation links, 27 exports and 10 negative public-type checks**;
SHA1 `063011613cbc423306e20f7cd0a7179ff0aae9f1`
(`/tmp/library-projection-package.log`). This artifact includes the accumulated
relationship declaration checks. A9's remaining bodies and consumer acceptance
stay open; no full/native suite or consumer migration was run for this batch.
Documentation build and whitespace checks pass
(`/tmp/library-projection-docs.log`).

## 2026-09-11: Relationship hardening retains the inspection-only hook contract

**138/214 complete; 76 open.** Review against the established computed-hook
contract found an error in the recent migration wording: `schemaRelationships`
is an inspection input, while `fields` is the supported computed-enrichment
output. The recent defensive checks correctly prevent malformed inspection-map
mutations from reaching published metadata, but do not establish a supported
relationship mutation API. Earlier entries describing hook-added relationships
record runtime regression probes, not authorization to use that path.

Corrected the migration guide to put relationship declarations in the resource's
`relationships` option and link to the existing computed-enrichment contract.
Removed the new tests' positive assertions that would unnecessarily require
valid mutations of the inspection map to remain supported. Positive string
mapping and forward-pivot checks remain on authored configuration; defensive
rejection probes remain on both paths. No runtime validator was removed.

The ten changed Node 24 mapping cases pass in each storage mode:
`/tmp/library-inspection-contract-{knex,anyapi}.log`. This review corrects an
unintended API implication rather than enlarging the selected hook contract.
Consumer reconciliation and the rest of A5-10 remain open.
Focused lint, documentation build and whitespace checks pass
(`/tmp/library-inspection-contract-lint.log`,
`/tmp/library-inspection-contract-docs.log`).

## 2026-09-11: Reverse relationship requirements share the enrichment boundary

**138/214 complete; 76 open.** Moved the existing reverse-relationship
validation dispatch into the shared relationship declaration check. Authored
registration and `computedSchema:enrich` now call the same hasMany, hasOne and
manyToMany validators; the old registration-only dispatch was removed. The
validators' required mappings and existing error messages are unchanged.
Polymorphic registered-target lookup remains in the registration hook.

Seven enrichment cases previously registered despite missing a required
mapping: hasMany/hasOne target or foreign key, and manyToMany pivot or either
backing key. All seven failed with missing expected rejection before the fix.
Node 24 namespace, schema-enrichment and stored-relationship suites pass
**170 ordinary + 196 canonical = 366 tests**; the many-to-many search suite
adds four passing tests per mode. Type checking passes. Logs:
`/tmp/library-reverse-shape-before.log`,
`/tmp/library-reverse-shape-{knex,anyapi}.log`,
`/tmp/library-reverse-shape-many-{knex,anyapi}.log`,
`/tmp/library-reverse-shape-types.log`.
Focused lint passes after removing blank lines left by moving the dispatch;
documentation and whitespace checks pass (`/tmp/library-reverse-shape-lint.log`,
`/tmp/library-reverse-shape-docs.log`).

The audit found legitimate manyToMany declarations without explicit `target`
in existing fixtures, so no new target requirement was added. The migration
guide records that distinction and the enrichment completion boundary.
A5-10 remains open for full configuration and actual downstream customization
acceptance. No comprehensive/native suite or consumer migration is claimed.

## 2026-09-11: Enriched polymorphic definitions reuse shape validation

**138/214 complete; 76 open.** The existing polymorphic validator is now also
called from the relationship namespace check after enrichment. It always
validates the target-list and backing-name shapes; registered-target lookup
still runs when the registration hook supplies its scope registry. No second
polymorphic shape validator or extra compilation pass was introduced. Target
list entries must now be nonempty strings rather than coercible property keys.

Eight hook-enrichment regressions failed with missing expected rejection before
the change: empty/string target lists, nested-array/empty target names, and
missing/array discriminator and identifier names. Node 24 namespace,
schema-enrichment and stored-relationship checks pass **163 ordinary + 189
canonical = 352 tests**. Existing polymorphic suites additionally pass nine
tests in each storage invocation. Type checking and focused lint pass.
Logs: `/tmp/library-poly-shape-before.log`,
`/tmp/library-poly-shape-{knex,anyapi}.log`,
`/tmp/library-poly-shape-relationships-{knex,anyapi}.log`,
`/tmp/library-poly-shape-types.log`, `/tmp/library-poly-shape-lint.log`.
The documentation build and whitespace check pass
(`/tmp/library-poly-shape-docs.log`).

The migration guide distinguishes shape checks from registered-target and
backing-column validation. A5-10 remains open for the full configuration and
consumer-customization contract. No comprehensive/native suite or consumer
migration is claimed by this change.

## 2026-09-11: Enriched backing names and belongs-to targets are checked

**138/214 complete; 76 open.** Continued the declaration audit through schema
`belongsTo` and hook-added `foreignKey`/`otherKey` values. Authored reverse
relationships already checked backing-name types later in `scope:added`, but
`computedSchema:enrich` could publish array backing names. The existing
relationship-name check now includes those options, covering both paths.
The existing schema-name check also rejects defined non-string `belongsTo`.

Six regressions failed with missing expected rejection before the fix: two
array belongs-to targets (authored/enriched), plus enriched hasMany/hasOne
foreign keys and both manyToMany backing keys. Node 24 namespace,
schema-enrichment and stored-relationship suites now pass **155 ordinary + 181
canonical = 336 tests**. Type checking passes. Evidence:
`/tmp/library-backing-names-before.log`,
`/tmp/library-backing-names-{knex,anyapi}.log`,
`/tmp/library-backing-names-types.log`.
Focused lint passes after correcting test formatting, and the documentation
build and whitespace check pass (`/tmp/library-backing-names-lint.log`,
`/tmp/library-backing-names-docs.log`).

The migration guide gives the string forms. A5-10 remains open for wider
configuration and actual late-customization acceptance. These name-type checks
do not establish backing-column existence, referential integrity, or complete
polymorphic declaration validation. No full or native suite was rerun for this
registration-only change, and no consumer or upstream files were modified.

## 2026-09-11: Relationship mapping names reject coercible arrays

**138/214 complete; 76 open.** The existing relationship namespace validator
now checks supplied `target`, `through` and `via` values are strings. It runs
for both authored declarations and the relationships returned by
`computedSchema:enrich`. It does not resolve target or pivot resources early
and introduces no extra compilation pass.

Ten new registration cases cover array targets for hasMany, hasOne and
manyToMany, an array pivot name, and an array reverse-polymorphic `via`, each
authored and hook-enriched. All ten failed with missing expected rejection
before the fix. Each case also now registers the corresponding string form
and checks its published mapping, including a not-yet-registered pivot name.

Node 24 namespace, relationship-metadata and schema-enrichment suites pass
**149 ordinary + 175 canonical = 324 tests**. After adding positive string
assertions, the ten changed cases pass again in each mode. Logs:
`/tmp/library-mapping-names-before.log`,
`/tmp/library-mapping-names-{knex,anyapi}.log`,
`/tmp/library-mapping-names-final-{knex,anyapi}.log`.
Type checking passes (`/tmp/library-mapping-names-types.log`).
Lint, documentation build and whitespace checks pass as well
(`/tmp/library-mapping-names-lint.log`, `/tmp/library-mapping-names-docs.log`).
The migration guide records the array-to-string corrections and explicitly
preserves forward references. A5-10 remains open: this does not establish
complete relationship shape or target-field validation. No consumer files,
upstream dependencies or positioning behavior changed.

## 2026-09-11: Relationship aliases reject non-string configuration

**138/214 complete; 76 open.** The existing schema namespace validator now
rejects defined non-string `as` values before they become relationship keys.
It already runs on authored fields and again after `schema:enrich`, so this
requires no new validator or compilation pass. Existing missing-alias and
reserved-name checks remain in place.

Eight registration regressions (number, boolean, array and object, each authored
and hook-enriched) all failed with missing expected rejection before the fix.
They now pass in both storage modes. The migration guide gives the concrete
`as: ['owner']` to `as: 'owner'` correction.

Node 24 acceptance: namespace and stored-relationship suites pass 100 ordinary
and 107 canonical tests; schema-enrichment and relationship-helper suites pass
43 ordinary and 62 canonical tests, **312 passing tests total**. Type checking
and lint pass. Logs: `/tmp/library-alias-before.log`,
`/tmp/library-alias-{knex,anyapi}.log`,
`/tmp/library-alias-enrichment-{knex,anyapi}.log`,
`/tmp/library-alias-types.log`, `/tmp/library-alias-lint.log`.
The documentation build and whitespace check also pass
(`/tmp/library-alias-docs.log`).

This is bounded progress under A5-10, not completion of all relationship shape,
forward-reference or consumer customization validation. No full suite, native
database suite or consumer migration is claimed by this registration-only fix.

## 2026-09-11: Default storage helper contracts checked

**138/214 complete; 76 open.** All eight missing-storage placeholder bodies
now use strict checking and satisfy the existing read/write interfaces. Their
unused positional parameters are replaced by the actual single request
envelope, while every body retains its existing unconditional rejection.
`@satisfies` retains inferred `Promise<never>` instead of falsely advertising
successful placeholder results. No new backend abstraction is introduced.

Four negative type cases cover positional calls, missing scope identity,
unprepared write context and assumed successful results. Positive assignments
cover both ordinary and canonical helper interfaces. Eight runtime checks pass
an input getter trap and prove rejection occurs without examining caller data.

Node 24 verification:

- Strict types: exit 0 (`/tmp/library-default-storage-types.log`).
- Targeted placeholder tests: **8/8**, zero failures/skips, exit 0
  (`/tmp/library-default-storage-runtime.log`).
- Scoped lint: exit 0 (`/tmp/library-default-storage-lint.log`).

No database matrix is claimed: these are unconditional missing-backend failures,
not installed storage behavior. Earlier package/full gates predate the parameter
annotation change. A9 remains open; consumers and positioning are unchanged.

## 2026-09-11: Diagnostic formatter body under strict checking

**138/214 complete; 76 open.** The diagnostic formatter and its recursive
serializer now check their implementation against unknown inputs and recursive
diagnostic output. Primitive/array/object previews are explicit; object errors
have non-null formatted maps, arbitrary thrown inputs retain nullable results,
and custom JSON metadata remains value-typed rather than assumed text.

Property reads box primitives while preserving null absence and catching hostile
accessors. Summary traversal uses the existing guarded reader and array checks.
The logger boxes metadata for spreading and narrows its formatted argument list;
a non-array preview remains one argument. Existing budgets and redaction rules
are unchanged. No new serializer, cache or compatibility path is added.

Four further negative type cases bring the logger/formatter fixture to twelve.
A runtime case verifies primitive property access, null/undefined absence and
boolean/number/BigInt/symbol previews. Existing cases cover binary metadata,
custom JSON, accessor failures, nested causes, redaction and bounded output.

Node 24 verification:

- Final strict types: exit 0 (`/tmp/library-formatter-types-final.log`).
- Ordinary logger/formatter/write/HTTP diagnostics: **57/57**, zero failures/skips,
  exit 0 (`/tmp/library-formatter-runtime-knex.log`).
- Canonical selection: **57/57**, zero failures/skips, exit 0
  (`/tmp/library-formatter-runtime-anyapi.log`).
- Scoped lint: exit 0 (`/tmp/library-formatter-lint.log`).
- Packed public types/content: exit 0; **153 files, 436,148 packed bytes,
  232 local documentation links, 27 exports, 10 negative checks**;
  SHA1 `4483a04ead5c464dce716250a8b00fe38283447a`
  (`/tmp/library-formatter-package.log`).
- Documentation build: exit 0 (`/tmp/library-formatter-docs.log`).
- `git diff --check`: passes.

This advances A9 without claiming all changed library modules are checked.
Upstream logger propagation and the remaining output-owner audit are separate;
consumer and positioning work remain paused. No comprehensive suite was rerun.

## 2026-09-11: Migration guide puts the core port first

**138/214 complete; 76 open.** The migration guide now starts with its common
checklist, runtime, option renames, inputRecord/mixed-format migration,
configuration, results, context, relationships, transactions and verification.
TypeScript and specialized feature material follow. Previously the payload
convention appeared after more than 800 lines of specialized guidance.

The reorder checks that all **65 section bodies, headings and code fences are
byte-for-byte unchanged**; thirteen primary sections are grouped at the front.
Existing anchors and example selectors remain valid. No application needs a
new API change because the guide was reorganized, and no runtime code changed.

Node 24 `npm run test:migration-guide` exits 0 in both storage modes
(`/tmp/library-migration-order-examples.log`), executing response-option,
payload, linkage and transaction examples against this checkout. This is local
library example verification, not paired consumer migration acceptance.
The packed public-type/content check also exits 0: **153 files, 435,816 packed
bytes, 232 local documentation links, 27 exports and 10 negative checks**;
SHA1 `c3e127d514153d535c3c274c40038615914e2033`
(`/tmp/library-migration-order-package.log`). This includes the final guarded
property-reader annotations from the logger batch. The documentation build
exits 0 (`/tmp/library-migration-order-docs.log`).
`git diff --check` passes. A10's broader consolidation and paused positioning
example remain open; other repositories are unchanged.

## 2026-09-11: Enhanced logger under strict checking

**138/214 complete; 76 open.** The enhanced logger body now checks optional
writers, unknown writer results, convenience-method receiver requirements and
redaction/compiled-field options. Shared metadata reuses storage field types.
Eight negative fixtures accompany positive async/readonly/console/extra-property
cases. In-place enhancement retains object identity and typed existing members.

Formatter declarations previously required Error inputs and defaulted options
as mandatory fields. They now match unknown thrown input, optional options and
nullable property-map output. The formatter/serializer bodies remain unchecked.
Validation detail reads use the existing guarded property reader; no new error
normalizer or runtime compatibility layer is added. Method installation retains
strict assignment failure for non-writable writers, verified by a regression.

Node 24 verification:

- Ordinary logger/formatter/write/HTTP diagnostics selection: **56/56**, zero
  failures/skips, exit 0 (`/tmp/library-logger-runtime-accepted-knex.log`).
- Canonical selection: **56/56**, zero failures/skips, exit 0
  (`/tmp/library-logger-runtime-accepted-anyapi.log`).
- Scoped lint: exit 0 (`/tmp/library-logger-types-lint-final.log`).
- Final strict types, including eight negative fixtures: exit 0
  (`/tmp/library-logger-types-final-accepted.log`).
- Packed public types/content checkpoint: exit 0; **153 files, 435,242 packed
  bytes, 232 local documentation links, 27 exports and 10 negative checks**;
  SHA1 `92fa2dde7df5da28eedfec30108461cf5910190f`
  (`/tmp/library-logger-types-package.log`). Two subsequent JSDoc annotations
  narrow guarded property reads/envelope errors to unknown; final strict types
  cover those annotations, while this package hash predates them.
- Documentation build: exit 0 (`/tmp/library-logger-types-docs.log`).
- `git diff --check`: passes.

Subsequent adjustments only refine generic input and in-place return
declarations and their positive type fixtures; runtime code matches these runs.
No comprehensive suite is repeated for this batch. Broader A9, upstream logger
behavior and consumer migration remain open.

## 2026-09-11: Method comments match the selected operation contract

**138/214 complete; 76 open.** The leading comment blocks for all eleven core
data/relationship method implementations now describe the actual operation
boundary. Earlier comments incorrectly described QUERY as sending an HTTP
request, GET/relationship helpers as positional public signatures, POST as
JSON:API-only with a guaranteed full response, and DELETE as returning an HTTP
status. The updated text points to method-specific behavior instead of
duplicating public option examples.

The related-document helper is distinguished from its outer format conversion.
PUT creation/replacement and PATCH omission behavior remain explicit.
`patchRelationship` delegates mutation/version work with its existing transaction;
the outer relationship method runs its own finish hooks and completes that
transaction only if it owns it. The comment was checked against that actual
delegation rather than assuming nested PATCH owns completion.

Eleven comment blocks shrink from **101 to 55 lines**. The editing check proves
all text outside those leading blocks unchanged; the follow-up corrections also
touch only those blocks. This is documentation cleanup, not a runtime refactor
or a claim that the method bodies are fully statically checked.

Node 24 strict types pass (`/tmp/library-method-comments-types.log`), scoped
method-directory lint passes (`/tmp/library-method-comments-lint.log`), and
`git diff --check` passes. No runtime suite was repeated for comment-only edits.
The full A10-03 comment audit remains open; positioning and consumer source were
not changed.

## 2026-09-11: Local API migration audit identifies the remaining example gap

**138/214 complete; 76 open. B0-08 remains open.** The
[local API migration audit](local-api-migration.md) records a Node 24 parser
inspection of 1,043 POST/PUT/PATCH-named property calls across 362 source files.
Literal objects missing `inputRecord` are two schema-validation calls and one
intentional shorthand rejection. A guide-fence probe covers 106 calls across
37 Markdown files; its only shorthand candidate is the labelled old migration
example. Both probes exit 0; their scope and dynamic-call limitations are explicit.

Retired option spellings in source belong to the rejection mechanism, public
negative types and rejection tests. Internal `simplified` flags are derived
representation state, not a public option parser. No active source import of
the removed adapter/writing-transformer modules was found.

The positioning guide still presents plain JSON as a built-in HTTP POST body,
contradicting the selected connector contract. Positioning is paused, so neither
the guide nor plugin was changed. This finding keeps B0-08 open, along with
reconciliation of dynamic callers against existing behavior/example evidence.
No new runtime or test-suite execution is claimed for this read-only audit;
the documentation and master plan now record the concrete gap. Other library
work remains available, and consumer repositories remain untouched.

## 2026-09-11: Library call-convention inventory accepted

**138/214 complete; 76 open. B0-01 complete.** The
[call-convention inventory](resource-call-inventory.md) maps all fourteen data
operations to their payload, identity, query, control and result conventions.
It also accounts for registered permission/enrichment/filter methods, ordinary
and canonical schema methods, route/release methods and the API-level transaction
callback. Resource declaration/access and familiar CRUD names remain unchanged.

The audit reads actual `addScopeMethod`/`addApiMethod` registrations, parameter
handling and the public resource/relationship/bulk/transaction declarations.
The supporting-method table explicitly records `applyQueryFilters` as mutating
its builder without returning a record; it does not invent a builder-return
overload. No additional built-in bulk-import resource method was found.

Node 24 verification:

- `npm run test:api-reference`: exit 0 in both storage modes. Executed schema,
  hooks, computed output, filtering, pagination, target ID and return modes pass
  (`/tmp/library-call-inventory-reference.log`). This script does not claim a
  test-runner case count.
- `npm run test:public-types`: exit 0; **152 files, 435,852 packed bytes,
  232 local documentation links, 27 runtime exports and 10 negative checks**.
  Tarball SHA1: `f8e2064e83f0e128426eea6e57f6a9f9de006d0e`
  (`/tmp/library-call-inventory-package.log`). This artifact includes the latest
  Socket.IO fixes and preceding converter/selection changes.

Existing response-option conformance separately proves the fourteen-operation
behavioral matrix; this inventory does not replace it. B0-01 does not require
changing consumers and does not close M-02, B0-08 or paired migration acceptance.
The library-first split remains explicit. No consumer repository was accessed
or modified, and no comprehensive suite was rerun for the inventory.

## 2026-09-11: Late room joins clean disconnected socket membership

**137/214 complete; 77 open.** Admission now rechecks connection state after
awaiting a join. A late join after disconnect runs the adapter's existing
`delAll(socket.id)` cleanup and rejects admission, allowing the existing catch
to remove the reserved subscription. No extra cache or registry is introduced.

Both real-transport regressions fail before the change
(`/tmp/library-socket-disconnect-before.log`). An isolated loader probe removes
the first disconnect-check draft and confirms all three residuals: one logical
subscription, room membership and a tracked adapter socket
(`/tmp/library-socket-disconnect-probe.mjs` and `.log`). The probe does not edit
production files and is not shipped.

The first fix used room departure and still failed the socket-index assertion:
the installed adapter's `del` retains an empty `sids` entry. The two draft
contract runs each record **120 pass / 2 fail** in
`/tmp/library-socket-disconnect-{knex,anyapi}.log`. Final cleanup uses `delAll`,
the operation Socket.IO itself uses to remove a disconnected socket completely.

Node 24 final verification:

- Ordinary Socket.IO contracts: **122/122**, zero failures/skips, exit 0
  (`/tmp/library-socket-disconnect-accepted-knex.log`).
- Canonical Socket.IO contracts: **122/122**, zero failures/skips, exit 0
  (`/tmp/library-socket-disconnect-accepted-anyapi.log`).
- Focused disconnect cases: **2/2**, zero failures/skips, exit 0
  (`/tmp/library-socket-disconnect-final.log`).
- Scoped lint: exit 0 (`/tmp/library-socket-disconnect-lint-final.log`).

The test controls adapter completion and waits for the actual admission handler
to settle; it does not assume a timeout means cleanup happened. Both membership
maps and logical subscriptions must be empty. Earlier Redis/full/package gates
predate this correction. Broader A7/A9 remain open; other repositories are
unchanged.

## 2026-09-11: Notification warnings cannot fail resource writes

**137/214 complete; 77 open.** Query-matching and final permission warning
writers are guarded and awaited. A diagnostic sink failure no longer turns the
existing non-match/skip behavior into resource failure or aborts later permitted
recipients. No authorization rule or successful write result is changed.

Four regressions fail before the change
(`/tmp/library-socket-warning-before.log`). Final cases include two subscribers:
one rejected and one permitted through trusted server-side fixture auth. They
verify acknowledged commit, persisted record, no forbidden notification and
delivery to the permitted subscriber over WebSocket and polling.

Node 24 verification:

- Ordinary Socket.IO contracts: **120/120**, zero failures/skips, exit 0
  (`/tmp/library-socket-warning-knex.log`).
- Canonical Socket.IO contracts: **120/120**, zero failures/skips, exit 0
  (`/tmp/library-socket-warning-anyapi.log`).
- Final focused recipient-isolation selection: **4/4 per mode, 8 total**,
  zero failures/skips, exit 0 (`/tmp/library-socket-warning-final-knex.log`
  and `/tmp/library-socket-warning-final-anyapi.log`). The recipient assertions
  were added after the two 120-case runs; production source is identical.
- Scoped lint: exit 0 (`/tmp/library-socket-warning-lint-final.log`).

This covers synchronous diagnostic sink failure, not asynchronous propagation
through hooked-api. The earlier Redis and comprehensive gates predate the fix.
No consumer or dependency source was changed; broader A7/A9 remain open.

## 2026-09-11: Successful subscriptions survive diagnostic failure

**137/214 complete; 77 open.** Successful subscription logging is guarded and
awaited after the room join. A throwing sink previously reported subscription
failure even though the subscription and its room were already installed.
Acknowledgements, creation events and restored-subscription results now retain
success. Admission-error diagnostics are awaited inside their existing guard.

Six regressions fail before the correction
(`/tmp/library-socket-success-before.log`). Each client response is checked
against the single installed subscription and room. The test fixture now enables
informational logging, ensuring the original success-log call actually executes.
Its generic diagnostic-failure selector replaces the earlier auth-specific
variable name; no runtime logging configuration was changed.

Node 24 verification:

- Ordinary Socket.IO contracts: **116/116**, zero failures/skips, exit 0
  (`/tmp/library-socket-success-knex.log`).
- Canonical Socket.IO contracts: **116/116**, zero failures/skips, exit 0
  (`/tmp/library-socket-success-anyapi.log`).
- Scoped lint: exit 0 (`/tmp/library-socket-success-lint.log`).

These cover synchronous sink failure. Awaiting the local logger does not prove
asynchronous propagation through the installed hooked-api dispatcher. The prior
Redis/lifecycle gate predates this diagnostic-only change; no new Redis or
comprehensive run is claimed. A7/A9 and the remaining output-owner audit stay
open, and consumer repositories remain untouched.

## 2026-09-11: Unsubscribe completion preserves concurrent room membership

**137/214 complete; 77 open.** Unsubscribe now awaits adapter departure before
success acknowledgement, preserves logical removal after adapter failure, and
reports null failures even when diagnostic logging throws. Success logging
cannot produce a second contradictory acknowledgement.

A small local helper orders room joins/departures per socket. Its WeakMap tail
is deleted after settlement; failed mutations reject their own caller and do
not prevent the next mutation. No state is added to serialized socket data,
resource contexts or consumer APIs. Permission hooks remain outside this order.

Four real WebSocket/polling regressions fail on the preceding implementation
(`/tmp/library-socket-leave-before.log`). They verify delayed acknowledgement,
concurrent new membership, failed departure/logging, logical removal and retry.
An isolated loader removes only ordering while retaining awaits; both concurrent
membership cases then fail because the room is lost
(`/tmp/library-socket-room-order-probe.mjs` and `.log`). The loader is not shipped
and does not edit production source. This evidence justifies ordering beyond
merely awaiting the adapter.

Node 24 verification:

- Ordinary Socket.IO contracts: **110/110**, zero failures/skips, exit 0
  (`/tmp/library-socket-leave-knex.log`).
- Canonical Socket.IO contracts: **110/110**, zero failures/skips, exit 0
  (`/tmp/library-socket-leave-anyapi.log`).
- Focused real Redis/lifecycle harness: **46/46 per storage mode, 92 total**,
  zero failures/skips, exit 0 (`/tmp/library-socket-room-redis.log`). This runs
  `node scripts/test-databases.js redis` with the retained local Redis binary.
- Scoped lint: exit 0 (`/tmp/library-socket-leave-lint.log`).
- `git diff --check`: passes.

The public Socket.IO guide now states acknowledgement timing and the distinction
between logical unsubscribe and failed room cleanup. The broader event/logging
audit and A7/A9 remain open. No comprehensive library gate or consumer check is
claimed, and no other repository was modified.

## 2026-09-11: Subscription admission survives non-Error room failures

**137/214 complete; 77 open.** Subscription and restoration response formatting
now share one local helper using the existing safe error-message conversion.
Null/undefined room-join failures produce a stable subscription error, including
the no-ack event path. A throwing error-code accessor cannot interrupt the
response. This introduces no compatibility layer or storage abstraction.

Twelve regressions fail before the change
(`/tmp/library-socket-join-before.log`): subscribe acknowledgement/event timeouts
and incorrectly aborted restoration batches. The tests inject server-side room
join failures, verify no subscription/room remains, restore the adapter, and
successfully retry the same subscription ID. Two additional regressions check
throwing code accessors. Each scenario uses real WebSocket and polling clients.

Node 24 verification:

- Ordinary Socket.IO contracts: **104/104**, zero failures/skips, exit 0
  (`/tmp/library-socket-join-knex.log`).
- Canonical Socket.IO contracts: **104/104**, zero failures/skips, exit 0
  (`/tmp/library-socket-join-anyapi.log`).
- Final focused room-join selection, including the two subsequently added
  code-accessor checks: **14/14**, zero failures/skips, exit 0
  (`/tmp/library-socket-join-final.log`).
- Scoped lint: exit 0 (`/tmp/library-socket-join-lint-final.log`).

The production fix is the same in all three runs. Earlier full/package gates
predate the change. No comprehensive gate, native database or Redis run is
claimed. Unsubscribe completion and other event-handler diagnostics remain to
review; A7/A9 stay open. No consumer checkout was changed.

## 2026-09-11: Socket authentication retains the original rejection

**137/214 complete; 77 open.** The Socket.IO authentication boundary no longer
dereferences null/undefined rejection values. It uses the existing safe error
message helper and retains the original rejection as the connection error's
cause. Failure hooks still observe the exact original value. Guarded, awaited
failure-hook/error-warning logs cannot replace authentication failure with a
synchronous sink failure or prevent connection rejection.

Eight new real-transport regressions fail on the previous source
(`/tmp/library-socket-auth-before.log`): null/undefined rejections and failed
warning logging time out awaiting `connect_error`; failed failure-hook logging
returns the sink error instead of the original rejection. All scenarios run
over WebSocket and polling, and assert no socket was admitted.

Node 24 verification:

- Ordinary Socket.IO contracts: **92/92**, zero failures/skips, exit 0
  (`/tmp/library-socket-auth-knex.log`).
- Canonical Socket.IO contracts: **92/92**, zero failures/skips, exit 0
  (`/tmp/library-socket-auth-anyapi.log`).
- Final focused regression rerun using the fixture's injected rejection value:
  **8/8**, zero failures/skips, exit 0
  (`/tmp/library-socket-auth-final-regressions.log`).
- Scoped lint: exit 0 (`/tmp/library-socket-auth-lint-final.log`).

The source fix is identical in both 92-case runs and the final regression run.
The fixture uses an explicit rejection flag so undefined remains injectable,
without literal-throw or literal-promise-rejection lint suppressions.
No full gate, native database or Redis rerun is claimed for this authentication
boundary. Asynchronous propagation through hooked-api's logger, other event
handlers and broader A7/A9 guarantees remain open. Consumer repositories remain
untouched.

## 2026-09-11: Sparse computed selection avoids full metadata scans

**137/214 complete; 77 open.** Sparse selection now checks requested names
directly in the existing compiled computed-field map. Default selection retains
declaration order and visibility; explicit selection retains request order,
duplicates, normally-hidden eligibility and exclusion of hidden/inherited names.
The helper signature stays unchanged. Repetitive JSDoc was replaced by a concise
description of these selection rules. No new metadata, cache or API is added.

For one existing and one missing requested name against 200 definitions, the
old helper performs one map enumeration and 200 definition reads; the new helper
performs zero enumerations and one definition read. The old-source regression
passes output assertions and fails the work-count assertion
(`/tmp/library-computed-selection-before.log`). This measures helper work only;
no wall-clock, SQL or application throughput gain is claimed.

Node 24 focused verification:

- Ordinary SQLite, five selected files: **196/196**, zero failures/skips,
  exit 0 (`/tmp/library-computed-selection-knex.log`).
- Canonical SQLite, same selection: **202/202**, zero failures/skips,
  exit 0 (`/tmp/library-computed-selection-anyapi.log`).
- Strict types: exit 0 (`/tmp/library-computed-selection-types.log`).
- Scoped lint: exit 0 (`/tmp/library-computed-selection-lint.log`).

The runtime selection covers direct selection semantics and work counts,
fieldsets, dependency order/visibility, compiled output and computed callbacks.
The earlier comprehensive and package gates predate this change. No native or
full-suite rerun was needed for this JavaScript-only selection change. Broader
A5/A10 acceptance remains open; no consumer repository was accessed or changed.

## 2026-09-11: Resource conversion under strict checking

**137/214 complete; 77 open.** The existing ordinary belongs-to converter body
now uses strict checking and shared storage/representation types. Its base
converter has declared nullable/non-null overloads, but that base implementation
and the complete response assembler are still unchecked. Seven negative type
fixtures and two direct runtime cases accompany existing integration coverage.
No new conversion helper or compatibility path was added.

The two initially failing direct cases used an invalid hand-written ID mapping:
`idProperty` must name the physical ID column, with logical `id` mapped to it.
Correcting the fixtures resolves those failures without a runtime ID fix.

Node 24 verification:

- Five-file focused runtime selection: **146/146**, zero failures/skips, exit 0
  (`/tmp/library-record-conversion-runtime-final.log`).
- Strict types including seven negative fixtures: exit 0
  (`/tmp/library-record-conversion-types-final.log`).
- Scoped lint: exit 0 (`/tmp/library-record-conversion-lint-final.log`).
- Documentation build: exit 0 (`/tmp/library-record-conversion-docs.log`).
- `git diff --check`: passes.

The earlier comprehensive gate and packed-artifact checks predate this batch;
they are not claimed as its verification. A9 remains open.

The maintainer's library-first instruction is now explicit in the master plan.
The [remaining-work split](library-first-remaining-work.md) identifies library
acceptance and external work for all 34 mixed items, without increasing the
denominator or treating migration-dependent parents as complete. Independent
library work continues; changing other software remains paused.

## 2026-09-11: Field selection and visibility under strict checking

**137/214 complete; 77 open.** All eight existing field utility bodies now use
strict checking, shared field metadata and explicit fieldset/result types.
JSON:API/plain overloads preserve their distinct shapes, including plain user
fields named `data` and `attributes`. A structural member-map view reflects the
selector's actual responsibility: filtering keys while leaving retained values
unchanged. No helper, runtime schema or compatibility layer was added.

The first read suggested a null-document issue for the literal fieldset resource
name `undefined`. An isolated prior-path probe disproved that hypothesis: the
existing map lookup distinguishes missing type from the string key. The result
is recorded in `/tmp/library-field-utils-null-before.log`; no such bug is
claimed. The new explicit guard supports static narrowing, and a test preserves
the existing behavior. Other direct cases cover plain data-name collisions and
relationship value identity/member-map replacement.

Node 24 verification:

- Six-file ordinary SQLite selection: **224/224**, zero failures/skips, exit 0
  (74088), `/tmp/library-field-utils-runtime-knex.log`.
- Same AnyAPI-selected files: **229/229**, zero failures/skips, exit 0 (7665),
  `/tmp/library-field-utils-runtime-anyapi.log`.
- Strict types, including eleven new negative fixtures: exit 0 (94572),
  `/tmp/library-field-utils-types-accepted.log`.
- Scoped lint: exit 0 (37131), `/tmp/library-field-utils-lint.log`.
- `git diff --check`: passed.

These focused checks follow the comprehensive gate below. It was not rerun,
and the last package hash predates this field-utility typing batch. Broader A9
body checking and consumer acceptance remain open.

## 2026-09-11: Relationship helper bodies under strict checking

**137/214 complete; 77 open.** A9 checking now covers the four existing
relationship-contract helper bodies using the shared field definition type.
Generic metadata lookup preserves caller-specific fields and nullable results;
cardinality remains a nullable one/many discriminator. No new runtime helper or
parallel metadata system was introduced.

The first annotation draft incorrectly assumed that the checked canonical mapper
already had a string target type and a required resource name. The compiler
exposed those assumptions. The accepted signature takes unknown stored values
and optional diagnostic scope; the existing membership rejection now also checks
that the target type is a string. An isolated copy without that guard emitted
`{ type: 42, id: '1' }` for malformed numeric target metadata; the new regression
requires a contextual rejection instead. Existing authored schemas already
require string target names. Null/undefined absence, zero/BigInt IDs and valid
string linkage retain their behavior.

Node 24 focused verification:

- Four-file helper/capability/polymorphic selection: **85/85**, zero failures or
  skips, exit 0 (60017), `/tmp/library-relationship-contract-runtime.log`.
- AnyAPI-selected helper/polymorphic selection: **13/13**, zero failures or
  skips, exit 0, `/tmp/library-relationship-contract-anyapi.log`.
- Strict typechecking, including seven new negative contract fixtures: exit 0
  (13947), `/tmp/library-relationship-contract-types-accepted.log`.
- Scoped lint: exit 0 (2022), `/tmp/library-relationship-contract-lint-final.log`.

The packed-public check subsequently passed (95447): 152 files, 434,977 packed
bytes, 232 local documentation links, 27 runtime exports and ten negative type
checks; SHA-1 `1f034e7c07c08c818e23ffb7ae9c64e76ce1d5fb`,
`/tmp/library-relationship-contract-package.log`. This package includes the API
reference correction and relationship-helper change; it predates the later
field-utility typing work.

The prior comprehensive gate below predates these annotations and the numeric
type guard. No new comprehensive or native-driver matrix was run for this
local contract change. Broader A9 typing and consumer acceptance remain open.

## 2026-09-11: Accumulated storage and diagnostic gate passed

**137/214 complete; 77 open.** Node 24.6.0 `npm run verify` completed with exit
0 (9784), `/tmp/library-diagnostic-storage-full-verify.log`. This is the completed
run previously recorded as pending; no replacement full invocation was started.

| Stage | Pass | Fail | Skip | Duration |
| --- | ---: | ---: | ---: | ---: |
| Ordinary SQLite | 5,803 | 0 | 1 | 501.359 s |
| Canonical SQLite | 5,903 | 0 | 0 | 415.080 s |
| Express 4 / ordinary | 464 | 0 | 0 | 36.697 s |
| Express 4 / canonical | 466 | 0 | 0 | 42.978 s |
| Total | 12,636 | 0 | 1 | |

Internal types, packed public checks, both query-budget jobs, lint and Jekyll
also passed. The documentation build took 5.486 seconds. The package stage
verified 152 files, 434,759 packed bytes, 232 local documentation links,
27 runtime exports and ten negative type checks; SHA-1
`d2edf25997e90c5693e3d6155d3fa6059451ab25`.

The gate covers the accumulated capability, storage-boundary, enrichment and
logging changes. The ordinary file list expanded before the new response-option
suite was added; its final 33 cases have separate six-job native coverage below,
and the canonical full run includes them. Expanded HTTP rejection assertions
have their separately recorded focused runs. The only later published-content
edit during the gate corrected two API-reference statements: built-in HTTP
routes use full JSON:API write responses, and a programmatic `returning: 'none'`
example does not describe HTTP creation. The migration guide and existing HTTP
parity tests already specify the correct behavior. The final documentation stage
includes that prose; the earlier package hash predates it.

The remaining A7/A9, consumer and final acceptance items remain open. Following
the maintainer's stricter cadence request, comprehensive runs are reserved for
rare major checkpoints with a concrete cross-cutting need and final acceptance;
individual checklist closures and prose changes use focused verification.

## 2026-09-11: Response-option acceptance audit

**137/214 complete; 77 open. B0-10 complete.** The new
`conformance-response-options.test.js` exercises 14 CRUD, relationship and bulk
methods. Its 33 cases make 451 rejected calls per storage mode: all seven
removed controls with true/false/explicit undefined, eight invalid formats and
nine invalid return values on each applicable write method. Every rejection
must identify the offending control and issue no SQL, including transaction
acquisition. Existing runtime validation already satisfies these cases; no
production response behavior changed.

The initial isolated draft passes 33 cases per SQLite mode (76546/35552),
`/tmp/library-response-options-audit-{knex,anyapi}.log`. Its first native matrix
passes **198/198**, 33 per SQLite/PostgreSQL/MySQL and storage-mode combination,
zero failures/skips, exit 0 (89882), `/tmp/library-response-options-native.log`.
Review corrected the draft bulk-PATCH input to its actual resource-object
contract and fixed four lint formatting errors. The final native selection
includes this corrected file and the existing format/default/override matrix.
It passes **558/558**, 93 per SQLite/PostgreSQL/MySQL and storage-mode
combination, zero failures/skips, terminal exit 0 (28644),
`/tmp/library-response-options-acceptance-native.log`. Final scoped lint passes
(6527), `/tmp/library-response-options-lint-final.log`.

The real HTTP test now checks every removed name with true, false and empty
values, alongside invalid fractional pagination. Express 5/Fastify selections
pass six cases per mode (88654/74299),
`/tmp/library-response-options-http-{knex,anyapi}.log`. The Express 4 override
invocations pass another six per mode (29174/85214),
`/tmp/library-response-options-express4-{knex,anyapi}.log`; those invocations also
repeat the three Fastify cases per mode. All four exit zero with no skips.

The [acceptance map](verification.md#response-option-acceptance-coverage)
identifies existing collision, default/override, bulk-return and lifecycle
assertions. This satisfies B0-10's option, precedence, collision, response-mode
and real-HTTP coverage; it does not close other API or consumer items.
Full gate 9784 subsequently passed as recorded above; its ordinary SQLite run passes **5,803/5,804**,
zero failures and one existing skip. Its file list expanded before the new
rejection file existed; the final native selection covers that file explicitly. Its canonical invocation will pick up the new
file normally. Later HTTP assertion edits have the separate focused runs above.
Consumer migration and other B0 items remain separate and paused.

## 2026-09-11: Validation logging preserves asynchronous completion

**136/214 complete; 78 open.** The A9 diagnostic audit found that both branches
of `logValidationError()` discarded the underlying writer result. Unlike the
ordinary log methods and `logError()`, callers could not await completion or
catch a rejected asynchronous sink. Both branches now return that result.
No wrapper, compatibility mode or new logging policy was added.

Six regressions cover synchronous results, pending asynchronous completion and
original rejection identity, with and without validation details. All six fail
before the fix (12 other cases pass), `/tmp/library-validation-logger-before.log`.
The six-file diagnostic/error selection passes **155/155**, zero failures/skips,
Node 24, exit 0 (4367), `/tmp/library-validation-logger-after.log`. Scoped lint
passes (56881), `/tmp/library-validation-logger-lint.log`. Broader A9 and upstream
dispatcher guarantees remain open; these results establish the helper boundary.

The subsequent accumulated Node 24 `npm run verify` gate completed successfully
as session 9784, `/tmp/library-diagnostic-storage-full-verify.log`; its exact
results and source timing are recorded above. `git diff --check` passes.

## 2026-09-11: Verification commands and plugin tutorial accepted

**136/214 complete; 78 open. A1-06 complete.** The command inventory now maps
conformance, native database/connector integration, internal types, package
checks and direct/paired consumer execution to their actual npm entry points.
The [failure-behavior review](verification.md#command-failure-behavior) reconciles
Node/TypeScript exits, aggregate `&&` commands, package assertions, native child
failures/timeouts and the shared consumer child runner. This closes command
availability/propagation, not consumer migration or final verification.

The real `npm run test:consumer` command used this repository as its consumer,
packed and installed the artifact, passed the import-resolution probe, then ran
`node -e 'process.exit(7)'`. It terminated nonzero as expected (99786), with
`node failed (7)` in `/tmp/library-consumer-exit-probe.log`. The temporary install
path emitted by that invocation was verified absent after failure. No jskit-ai,
vibe64 or seed checkout was accessed. Invalid database selection also terminates
nonzero before server startup (`/tmp/library-database-cli-invalid.log`). Earlier
failed type/package checks and the accumulated test-gate evidence retain their
own recorded scopes; they are not rerun or presented as new full-suite results.

The plugin tutorial now demonstrates trimming a declared string at
`beforeSchemaValidate`, replacing a misleading output-only-field deletion
fragment at that late stage. Its runnable example verifies both the returned
and persisted name. The existing tutorial runner accepts optional guide keys;
unknown keys fail before fixture creation, and no arguments still run all guides.

Node 24 tutorial results:

- `plugins`: two passing storage-mode scenarios,
  `/tmp/library-plugin-guide.log`.
- `plugins hooks`: four passing scenarios (38220),
  `/tmp/library-tutorial-selection-named.log`.
- Default full tutorial corpus: 27 passing scenarios (6490),
  `/tmp/library-tutorial-selection-default.log`.
- Unknown guide: expected nonzero exit with available keys listed,
  `/tmp/library-tutorial-selection-invalid.log`.
- Scoped script lint: exit 0 (62625), `/tmp/library-tutorial-selection-lint.log`.

The package check also passed: 152 files, 434,759 packed bytes, 232 local
documentation links, 27 runtime exports and ten negative type checks; SHA-1
`5bb219fb71813c7e7afbbffef8cd07d052d35e51`,
`/tmp/library-plugin-guide-package.log`. The documentation build completed in
12.805 seconds, `/tmp/library-plugin-guide-docs.log`. Both processes were
confirmed no longer running when their successful output was reconciled.

No production API behavior changed in this batch. Native tutorial execution
retains its previous separate evidence; these are SQLite guide runs. A10's full
prose/consolidation audit and all paused consumer work remain open.

## 2026-09-11: Projection warnings use bounded diagnostics

**135/214 complete; 79 open.** The query-projection input-stripper retained a
global-console fallback and built an unbounded field-name message. A throwing
warning sink also converted otherwise successful stripping into a write-stage
failure. It now uses the existing diagnostic formatter with operation/resource/
phase, total field count and bounded field names. It includes no submitted
attribute values, has no console fallback, and contains advisory sink failures.
The documented input behavior remains unchanged: projections are ignored on
writes and are still calculated from the database on reads.

All three new regression cases fail on the previous implementation
(`/tmp/library-projection-diagnostics-before.log`). They cover 200 long field
names, retained nonprojection input, excluded submitted values, exact metadata,
a throwing sink and absent configured logging. The selected diagnostic/logger/
projection suites now pass **23/23**, zero failures/skips, terminal exit 0
(17459), `/tmp/library-projection-diagnostics-after.log`. Scoped lint passes
(69736), `/tmp/library-projection-diagnostics-lint.log`.

A final async-sink review extended the same boundary: the projection hook and
version observer now await warning results and contain promise rejection as well
as synchronous throws. A fourth projection test and three driver-labelled
observer tests verify warning completion and preserved input/original observation
errors. The capability logger return type is now unknown, rather than implying
synchronous void. The combined four-file selection passes **96/96**, zero
failures/skips, terminal exit 0 (98934),
`/tmp/library-advisory-diagnostics-final.log`. Final scoped lint passes (9079),
`/tmp/library-advisory-diagnostics-lint.log`. These are local advisory-warning
guarantees, not acceptance of every dependency logging boundary.

A broader `console` search found two aliases missed by the direct-call pattern.
The has-one include loader discarded a supplied logger unless it exposed
`child()`. It now uses that logger directly and stays quiet when none is
provided. Both new regression cases fail before the change
(`/tmp/library-include-logger-before.log`). The six-file diagnostic/include
selection passes **173/173**, zero failures/skips, terminal exit 0 (85496),
`/tmp/library-diagnostic-owners-final.log`; scoped lint passes (62350).
The remaining registry alias is intentional for standalone construction and
already passes its rollback diagnostics through the shared bounded formatter;
installed storage supplies its configured logger. The other two matches are
JSDoc examples. This is not a claim that every dependency logger or extension
output path has been audited; broader A9 acceptance remains open.

Type checking passes (84305), `/tmp/library-advisory-diagnostics-types.log`.
The projection/capability packed artifact passes (75639): 152 files, 434,582
packed bytes, 231 local links, 27 runtime exports and 10 negative checks; SHA1
`95bfc720c10e2789e718cd1eba2ae91f814677fc`. That artifact predates the subsequent
has-one logger fallback change. Documentation builds successfully (81684),
`/tmp/library-advisory-diagnostics-docs.log`.
The final canonical include selection also passes **75/75** (45113),
`/tmp/library-include-logger-anyapi.log`, bringing the final focused verification
to **248 passing tests**, zero failures/skips. The final package check (16001)
passes with 152 files, 434,587 packed bytes, 231 local links, 27 runtime exports
and 10 negative checks; SHA1 `61e160d208bf904cccd9b82b8c7fd2202e55c08c`,
`/tmp/library-diagnostic-owners-package.log`.
No consumer or positioning implementation changed.

## 2026-09-11: Enrichment reuses compiled output definitions

**135/214 complete; 79 open.** `enrichAttributes` now gives hidden-field filtering
the already compiled `outputFields` map instead of merging stored, projected and
computed definitions per record. The unused query-field local is removed. No
compiler, cache, callback-order or output-option change was needed.

The regression uses real compiled fixture metadata and checks hidden and
normally-hidden output alongside stored/projected/computed values. Before the
change, two calls enumerate the stored map four times and the computed/projected
maps twice each; afterward the totals are two/zero/zero. The remaining stored-map
scan selects virtual fields. Output assertions already pass on the old source;
the new test fails specifically for the redundant derivation
(`/tmp/library-enrichment-index-before.log`). This removes three full-map
iterations and one merged dictionary allocation per represented resource, without
claiming a wall-clock speedup or altered initialization costs. See the
[metadata note](compiled-resources.md#enrichment-visibility-uses-the-compiled-output-map).

Node 24 results:

- Output-definition/getter/computed/schema-enrichment selection: **198/198**,
  ordinary 87 and canonical 111, zero failures/skips; terminal exits 0
  (23757/6082), `/tmp/library-enrichment-index-knex.log` and
  `/tmp/library-enrichment-index-anyapi.log`.
- Output-definition/schema-enrichment native selection: **348/348**, ordinary
  46 and canonical 70 per SQLite/PostgreSQL/MySQL; zero failures/skips, terminal
  exit 0 (78605), `/tmp/library-enrichment-index-native.log`.
- Types: exit 0 (97256), `/tmp/library-enrichment-index-types.log`; scoped lint:
  exit 0 (60163), `/tmp/library-enrichment-index-lint-final.log`.
- Packed declarations/content: exit 0 (39543), 152 files, 434,446 packed bytes,
  231 local links, 27 runtime exports and 10 negative package checks;
  SHA1 `2ee69751d4bc5dcf5ec87cf54ebc86e88f5088d4`,
  `/tmp/library-enrichment-index-package.log`.

The broader metadata items retain their remaining acceptance work, including
paused positioning initialization and consumer requirements. No consumer or
positioning implementation changed, and no new full-suite run is claimed.

## 2026-09-11: Storage-boundary declarations accepted

**135/214 complete; 79 open. A6-02 complete.** The
[acceptance map](storage-boundaries.md#storage-boundary-declaration-acceptance)
reconciles the operation inventory with the existing adapter/mapping/query,
read/write, relationship/count/link, transaction and capability declarations.
The final additions annotate relationship subquery helpers, canonical count/link
helpers and both transaction factories. Source inspection finds declarations on
all **10 ordinary and 11 canonical data/transaction assignments**. The existing
adapter remains the shared boundary; no generic backend or runtime interface
layer was introduced.

The new `data-relationship-contracts.js` fixture has eight negative cases covering
wrapped queries, pivot keys, parent IDs, count shape, synchronization mode, void
mutations, nullable raw link IDs and required parent lists. It also accepts the
actual standalone count context without requiring a supplied schema. Canonical
relationship queries retain their registry lookup instead of requiring ordinary
pivot metadata. The direct runtime regression proves awaiting the installed
helper executes no SQL, a constrained clone returns empty, and the original
builder still returns the complete requested membership.

Node 24 verification:

- Required typecheck: exit 0 (15020),
  `/tmp/library-storage-boundary-types-accepted.log`.
- Scoped lint: exit 0 (73651), `/tmp/library-storage-boundary-lint-accepted.log`.
- Native selection: **720/720**, 119 ordinary and 121 canonical checks on each
  of SQLite/PostgreSQL/MySQL, zero failures/skips; terminal exit 0 (85382),
  `/tmp/library-storage-boundary-native.log`. The four files cover the new
  deferred query, direct adapters, canonical link deletions and parent prefetch.
- Packed public declarations/content: exit 0 (23307), 152 files, 434,472 packed
  bytes, 231 local links, 27 runtime exports and 10 negative package fixtures;
  SHA1 `dbbe388475c03c52a471084ba1c7b335a18d8c96`,
  `/tmp/library-storage-boundary-package.log`.
- Documentation build: exit 0 (6550), `/tmp/library-storage-boundary-docs.log`.

The final additions are declarations, annotations and verification. They do not
claim every SQL/plugin implementation branch is checked: A9-03/A9-04/A9-05 own
that broader work. External raw-query/hook migration and consumer acceptance
remain open under A6-09/A6-10/A6-16 and Part M. No consumer repository was changed.
The 12,503-test accumulated full gate remains historical evidence; this focused
native run does not claim a new full-suite execution.

## 2026-09-11: Checked capability implementation

**134/214 complete; 80 open.** The database capability implementation now opts
into strict checking through the existing incremental configuration. Shared
storage declarations describe observations, logging, schema/insert mode unions,
nullable temporal precision and the actual frozen constants. Runtime version
values stay unknown until validated; regex digit conversion uses equivalent
`Number` conversion to avoid asserting optional regex captures are present.

Seven compiler-negative cases reject invalid database/logger/version arguments,
assuming transaction-only schema support, unchecked nullable precision, mutation
of frozen cardinalities and invalid returning expressions. The accepted typecheck
exits 0 (22735, `/tmp/library-capability-types-local-boundary.log`).

Checking exposed Knex's missing aliased-RETURNING declaration. The final source
uses one local signature assertion for the already verified string/raw alias
form and preserves the query receiver. It does not augment Knex globally or
claim its promise inference validates driver results. A discarded declaration
augmentation conflicted with inherited overloads; a draft declaration reference
to JavaScript constants also failed the packed consumer's no-JavaScript-checking
configuration. Both were corrected before acceptance: constants are checked
against standalone shared interfaces, and no consumer compiler-setting change
is required.

All **69 focused runtime tests pass**
(`/tmp/library-capability-types-runtime-accepted.log`), including real SQLite
installation/CRUD and query-returning receiver/argument assertions. The preceding
666-case native run remains evidence for the capability failure fix and existing
native insert forms; it is not presented as a rerun of these annotations. Broader
storage and lifecycle checking remains open under A6-02/A9.

Scoped lint passes (95622). The packed check passes (45550): 152 files,
434,050 packed bytes, 231 local links, 27 runtime exports and 10 negative checks;
SHA1 `e83d0d7d44dd951d0c4bf5e5248248a1cfde10cb`
(`/tmp/library-capability-types-package-accepted.log`). Documentation builds
successfully (30038, `/tmp/library-capability-types-docs.log`).

## 2026-09-11: Capability observation failure boundary

**134/214 complete; 80 open.** Database capability detection had repeated
handlers that read `.message` directly from driver throws. Null/undefined
rejections could therefore make the intended unknown-version fallback throw
again. Diagnostics also bypassed the configured logger through global console
calls.

The existing version observer now owns query/result validation and one failure
boundary. Both storage plugins pass their configured logger; standalone window
probes reuse the observer. Non-string version results become explicit unknown
observations. The shared bounded formatter supplies operation/phase/backend
metadata, and diagnostic sink failures cannot replace the retained original
error summary. Version-dependent probes reuse the unknown observation instead
of querying again; dialect-known PostgreSQL window support remains unchanged.
No new storage abstraction or runtime compatibility path was added.

The first 13 regression cases produce **10 failures / 3 passes** on the previous
source (`/tmp/library-capability-failure-before.log`). The final expansion adds
malformed result and direct-probe checks. Across the three capability/include/
schema-preflight files, Node 24 native verification passes **666/666**: 108 per
SQLite mode, 114 per PostgreSQL mode and 111 per MySQL mode; zero failures/skips,
terminal exit 0 (95604), `/tmp/library-capability-failure-native.log`.
Tests retain one version observation, original error text, conservative dynamic
capabilities, exact diagnostic metadata, bounded nested output and unchanged
original errors. Existing installed-plugin CRUD/returning and unsupported-schema
preflight assertions remain active.

Type checking passes (33736, `/tmp/library-capability-failure-types.log`), and
scoped lint passes after correcting formatting and using a named injected null
failure (8142, `/tmp/library-capability-failure-lint-final.log`). The source
change is library-only; consumer repositories remain untouched. A9-07/A9-08 and
A6-02 stay open for their broader acceptance requirements. No new full-suite run
was needed for this isolated boundary after the selected native checks.

The packed public check passes (33947): 152 files, 433,321 packed bytes,
231 local links, 27 runtime exports and 10 negative checks; SHA1
`e74df50a418ce86bb086b7067af917bbab23b9fd`
(`/tmp/library-capability-failure-package.log`). Documentation builds successfully
(34116, `/tmp/library-capability-failure-docs.log`).

## 2026-09-11: Optimization regression acceptance

**134/214 complete; 80 open. A8-11 complete.** The
[regression map](query-measurements.md#optimization-regression-coverage) reconciles
query counts, complete results, hidden fields, per-parent limits and callback
counts against the actual existing suites and workload runner. The previous
12,503-pass full gate covers the existing tests; this change expands the limited
include regression rather than rerunning that whole gate.

`conformance-include-allocation.test.js` previously counted group getters without
checking their identities. It now compares the exact selected names for getter
and computed callbacks, rejects read setters, and checks exact output attributes.
Sixteen additional cases exercise computed-only fieldsets alongside stored-name
fieldsets across GET/query, JSON:API/plain and standard/window/zero/unlimited
include selections. The existing hidden target, overlapping parents, duplicate
edges, complete membership and bounded read assertions remain active. The tests
pass on the current runtime; this is stronger regression coverage, not a newly
claimed runtime bug fix.

Node 24 results:

- Ordinary/canonical SQLite focused runs: **47/47 each**, sessions 35908/65557,
  `/tmp/library-include-callback-knex.log` and
  `/tmp/library-include-callback-anyapi.log`.
- Native harness: **282/282**, 47 in each SQLite/PostgreSQL/MySQL and storage-mode
  combination; zero failures/skips, terminal exit 0 (53440),
  `/tmp/library-include-callback-native.log`.
- Scoped lint: exit 0 (28151); documentation build: exit 0 (55644),
  `/tmp/library-optimization-regression-docs.log`. No runtime/dependency changes
  or consumer writes.

A8-04 still owns remaining justified optimization work; A8-12 still requires
consumer regression evidence. This acceptance does not close either item, and
later optimizations must extend the corresponding tests before acceptance.

## 2026-09-11: Accumulated typing and diagnostic verification

**133/214 complete; 81 open.** The complete Node 24 `npm run verify` passes
(`/tmp/library-typing-diagnostics-full-verify.log`, terminal session 10909).
This milestone includes the accumulated declaration-order search correction,
Socket.IO admission diagnostics, defensive diagnostic formatting, dead computed
input handling removal, and ID/response-option checking.

| Gate | Result |
| --- | --- |
| Internal and packed public types/content | Pass; 152 files, 439,652 packed bytes, 231 local links, 27 exports, 10 negative public fixtures |
| Both SQLite query-budget jobs | Pass |
| Full ordinary SQLite invocation | 5,753 pass, zero failures, one existing skip; 357.968s |
| Full canonical SQLite invocation | 5,820 pass, zero failures/skips; 392.166s |
| Express 4 ordinary | 464 pass, zero failures/skips; 53.200s |
| Express 4 canonical | 466 pass, zero failures/skips; 60.450s |
| Whole lint and documentation build | Pass |

Total: **12,503 passing tests, zero failures, one existing skip**. Packed artifact
SHA1: `9b7b206d7528ac6e8cb1e0a89ca091637fbf3679`. Native database/Redis and consumer
checks retain their separately recorded scopes; the full local gate does not
replace those jobs or final acceptance. Consumer work remains paused.

### Comment-only follow-up

After the gate completed, applied seven reviewed comment-only candidates:
plain-format helpers, relationship processing, schema compilation, schema/search
helpers, relationship configuration validation, default storage helpers and
response value normalization. Removed **1,302 lines** of stale or repeated prose
while retaining parameter/return documentation, short examples and actual
invariants. Corrections include absent automatic JSON:API detection, alias-object
output, all four relationship work collections, schemaInstance naming, the
limited missing-storage helper surface, normalization modes, non-DDL index flags
and relationship checks that do not inspect physical columns.

Each source fingerprint still matched its reviewed candidate before applying;
all seven executable ASTs matched before and after. Four literal replacement
examples execute with their stated output. Types (18423), scoped lint (45281)
and whitespace checks pass after applying. The subsequent packed public check
also passes (13926): 152 files, 433,573 packed bytes, 231 local links,
27 runtime exports and 10 negative checks; SHA1
`df9edddc0adfab89e624e36512bfd3fea9f94e4b`. The full gate above predates only
these comment edits. The candidate manifest and AST review inventory are retained
under `/tmp/library-comment-candidates` and `/tmp/library-long-comment-inventory.json`.
The inventory uses a JavaScript parser, avoiding a false comment match inside a
MIME string. A10-03 remains open for the rest of the implementation-comment review;
this batch is not a claim that every comment was audited.

## 2026-09-11: Response-option implementation under strict checking

**133/214 complete; 81 open.** Added strict checking to the existing response
option helpers. Unknown input/defaults are validated into the shared public
format and returning unions; omitted arguments retain the runtime defaults.
The returning-value membership test now uses explicit literal comparisons so
the implementation narrows the value without a type assertion. Removed-option
validation takes an already narrowed object and returns void.

Six negative fixtures reject single-format assumptions, mixing format with
returning, boolean results, unknown/null option objects and use of a void result.
The first draft's assertion-based fixture did not prove rejection; TypeScript
reported an unused directive, and it was replaced with checked assignments.
The final typecheck passes (`/tmp/library-response-default-types.log`, 85348).
All **15 focused response-option and connector-query-parser tests pass**
(`/tmp/library-response-option-runtime.log`, 72417), including actual resource
default/override behavior, invalid values, retired options and no unintended
writes. Scoped lint passes (84425). No consumer/native/full-suite run was needed
for annotations and equivalent literal validation; broader A9 checking remains
open.

## 2026-09-11: Resource-ID implementation under strict checking

**133/214 complete; 81 open.** Opted the existing resource-ID normalization
module into strict `@ts-check` and the typecheck configuration. The implementation
reuses the public normalizer callback contract and describes the minimal
scope/options lookup it consumes. Unknown input remains unknown; optional IDs
are nullable strings and required-ID helpers return strings or throw. Relationship
normalization intentionally returns unknown because later validation owns shape
acceptance. No new runtime interface or resource metadata copy was introduced.

Eight compile-time negative fixtures reject async/object-returning/narrow-input
normalizers, non-callable configuration, numeric resource names, unnarrowed
optional IDs and use of unvalidated relationship results. Full type checking
passes (`/tmp/library-id-contract-types-final.log`, 50321). The existing focused
ID command passes **102 ordinary + 98 canonical = 200 tests**, zero failures/skips
(`/tmp/library-id-checked-runtime.log`, 94413), covering configured normalization,
custom IDs and relationships. Scoped lint (3498) and whitespace checks pass;
the first lint run required changing a negative fixture's bare property access
into a method call. A9's broader lifecycle/metadata/type requirements remain
open. No consumer, native database or full-library rerun was needed for these
annotations and a property-binding refactor with unchanged behavior.

## 2026-09-11: Coordinated release procedure and required package job

**133/214 complete; 81 open. A98/138, B33/48, M2/14, C0/14. A10-11 is complete.**
The release procedure records the current consumer pause, refresh/reconciliation
of the parked migration, new-major/candidate version selection, scoped manifest
and lock changes, actual verification commands, exact-artifact paired checks,
seed discovery and workflows, dependency publication order, and recovery limits.
It separates this documented process from actual migration, publication and
production deployment. Consumer checks remain unauthorized while paused.

The existing clean-package script now has a dedicated Node 24.6.0 CI job. The
aggregate Verification job requires library, databases and package success.
Parsed workflow YAML and checked command/runtime/environment wiring; executing
its actual shell gate for all 64 success/failure/cancelled/skipped combinations
confirms that only three successful groups pass. This verifies local wiring,
not an observed GitHub Actions run.

`npm run test:clean-package` passes on Node 24.6.0
(`/tmp/library-release-clean-package.log`, 34087), with tarball SHA1
`229fe70019dbd94be6f3292d4787d0c84e2b9dd5`: core imports/missing optional Express,
then ordinary and canonical CRUD after a fresh SQLite native compilation.
Resolved dependencies include hooked-api 1.0.24, Knex 3.3.0 and better-sqlite3
11.10.0; the script checks that development tooling is absent and removes its
temporary consumer. It still packs version 1.0.29: no version, registry tag or
consumer dependency was changed. This does not imply pending hooked-api fixes
are installed or release readiness is achieved.

Release-guide link targets, whitespace checks and documentation build pass
(`/tmp/library-release-procedure-docs.log`, 59502). Verification docs now include
packed-type/content and clean-install scopes and remove stale Socket.IO coverage
claims. The full library suite was not repeated for this documentation/CI change.
A10-08–10, Part M and the final acceptance items retain their separate requirements.

## 2026-09-11: Dead computed-input warning removed

**132/214 complete; 82 open.** Auditing direct console output found a computed
field warning claiming input would be ignored. Executing POST/PUT/PATCH with
computed input contradicted that assumption: all reject with
`FIELD_NOT_ALLOWED` on the attribute. Compilation removes computed fields from
the writable schema, so the warning and its computed-field filtering branches
cannot run for compiled resources. Removed those obsolete branches rather than
introducing a logger parameter for unreachable output. The exploratory logging
changes were removed before final verification; the final implementation retains
the existing rejection contract.

Added regressions for all three methods asserting typed validation, the precise
field/rule, a rolled-back outcome, and unchanged full query results. The complete
computed-field and schema-enrichment selections pass **66 ordinary + 85 canonical
= 151 tests**, zero failures/skips (`/tmp/library-computed-input-{knex,anyapi}.log`,
38364/39603). Scoped lint passes (37100) after correcting test-object formatting.
The field-transformation guide now explicitly distinguishes rejected computed
input from writable virtual input. This advances A9's output audit and A10's
implementation/documentation reconciliation without changing the API or closing
either broad item. No consumer, native SQL or full-suite run was performed.

## 2026-09-11: Diagnostic inspection failures retain sibling metadata

**132/214 complete; 82 open.** A new enhanced-logger regression showed that an
invalid Date could abort formatting the entire event
(`/tmp/library-diagnostic-inspection-before.log`, exit 1). Extending the same
case exposed revoked-proxy classification escaping before the formatter ran
(`/tmp/library-diagnostic-proxy-before.log`, exit 1). The shared diagnostic
serializer now contains inspection failures per value; array access uses the
existing guarded property reader. Enhanced argument classification falls back
to that serializer if inspection itself fails. No caller data is mutated and
the existing preview budgets remain shared across the event.

The regression verifies readable array entries on both sides of a throwing
getter, an inaccessible proxy, a revoked proxy, the original event text and a
later public metadata argument. The existing writer-exception test continues
to require propagation of errors thrown by the sink itself. All **75 formatter,
enhanced-logger, error-context and HTTP-diagnostic tests pass**
(`/tmp/library-diagnostic-inspection-final.log`, 41106). Scoped lint (51562),
type checking (`/tmp/library-diagnostic-inspection-types.log`, 77195), and
whitespace checks pass. The first lint attempt rejected a literal non-Error
throw in the test; the fixture now uses a named null failure, preserving the
intended non-Error case. No database, consumer, or full-suite run was needed for
this diagnostic serialization change. Broader A9 output-owner work stays open.

## 2026-09-11: Socket subscription admission diagnostics

**132/214 complete; 82 open.** New real WebSocket/polling regressions reproduced
hidden and normally-hidden field values in direct subscription failure logs,
and absent diagnostics for failures while restoring subscriptions
(`/tmp/library-socket-admission-before.log`, four failures). The registration
boundary now logs both paths using the successfully resolved resource's schema,
with stable operation/admission phase/resource fields. Invalid names cannot
select inherited scope properties. The outer subscribe handler no longer logs
the same rejection again. Error identity and client rejection are preserved;
an unavailable diagnostic sink cannot replace the admission error.

The affected complete socket-contract and authorization suites pass **176 ordinary
+ 176 canonical = 352 tests**, zero failures/skips
(`/tmp/library-socket-admission-{knex,anyapi}.log`, 54264/95451). Six added tests
per mode cover both transports, direct and restored admission, retained visible
diagnostic content, unchanged original private fields, no accepted subscription
after rejection, and a throwing log sink. Explicit metadata assertions then pass
the six focused admission tests (`/tmp/library-socket-admission-metadata.log`).
Scoped lint passes (61879). This changes plugin-owned admission output; arbitrary
message text, authentication-specific policy and upstream dispatcher output
remain separate A9-07/A9-08 work. No Redis, native SQL, consumer or full-library
gate was repeated for this local logging boundary.

## 2026-09-11: Row-policy tutorial consolidated and executed

**132/214 complete; 82 open.** Replaced duplicate ordinary/canonical policy
installation snippets with one shared, executable policy and linked the existing
storage setup. The registered-resource example now creates its table and seeds
two workspace datasets. It demonstrates trusted context passed separately,
visibility before pagination/counting, and denial when workspace context is
absent. The guide explicitly distinguishes read visibility from ownership
stamping and write validation; detailed policy, recursive CTE and contributor
contracts remain available.

The existing tutorial checker executes all three literal blocks, verifies exact
visible titles and count, missing-context denial, and the public policy inspection
methods. Default SQLite execution passes 27 scenarios
(`/tmp/library-row-policy-guide.log`, 63124). The native corpus passes all six
jobs and disposes its database servers (`/tmp/library-row-policy-guide-native.log`,
91899): **78 SQL tutorial scenarios plus six repeated no-storage checks**, with
six new policy checks spanning both storage modes and SQLite/PostgreSQL/MySQL.
Scoped lint passes (36848). This is representative simple-policy execution;
it does not newly verify every recursive CTE or contributor snippet. No runtime
or consumer source changed, and the full library suite was not repeated.

## 2026-09-11: Schema guide mapped-ID example executed

**132/214 complete; 82 open.** The schema guide's JSON:API POST omitted
`format: 'jsonapi'` despite the plain-record default. Executing its literal
declaration and write reproduced validation failures for the nested `data`
field and missing logical ID/display name (`/tmp/library-schema-guide-before.log`,
exit 1). The example now selects its format explicitly. The guide also identifies
generated `exports.up`/`exports.down` source as CommonJS and explains using `.cjs`
with the migration loader in an ESM application.

Extended the existing migration-guide checker with that ordinary-table example.
It executes the generated create/drop migration, checks JSON:API output and raw
`user_id`/`display_name`/`login_count` columns, inspects the mapped primary key,
and requires an empty follow-up diff. The default run passes
(`/tmp/library-schema-guide-after.log`). The native runner passes all six jobs
(`/tmp/library-schema-guide-native.log`, 36493): the migration After snippets
run in both storage modes on SQLite/PostgreSQL/MySQL, while the added schema
scenario uses ordinary tables in each job. Repeated ordinary-table checks do
not establish canonical schema-migration support.

Scoped lint (24471), docs (`/tmp/library-schema-guide-docs.log`, 47398), and
whitespace checks pass. No runtime source or consumer repository changed; the
full suite was not repeated for this documentation/checker correction.

## 2026-09-11: Generated documentation anchor audit

**132/214 complete; 82 open.** Parsed 36 generated public documentation pages
and followed 91 local heading links against their target HTML IDs; no missing
heading was found. The initial file-path scan reported four distinct global
navigation URLs repeated across pages: QUICKSTART, API, ONBOARDING and
COMPARISON used extensionless paths while generated files have `.html` names.
Those counterparts exist. This does not establish a failure on a host that
supports extensionless routing; the shared layout now links to explicit `.html`
files so that such routing is unnecessary.

The audit parses generated HTML rather than guessing Markdown heading slugs.
It does not exercise external URLs or a deployed browser session. The initial
inventory is `/tmp/library-rendered-doc-links.json`. This improves navigation
verification but does not close the whole reference-consolidation item.

The rebuilt site completed generation (`/tmp/library-rendered-navigation-docs.log`).
Repeating the audit after the layout correction finds zero missing local files
or heading anchors across the same 36 pages and 91 heading links. The repository
whitespace check also passes.

The preceding projection guide passed scoped lint (79790), docs
(`/tmp/library-projection-guide-docs.log`, 38317) and whitespace checks.


## 2026-09-11: Projection guide consolidated and verified across drivers

**132/214 complete; 82 open.** Converted the projection guide's disconnected
fragments into six executable blocks with declared authors/books, seeded data,
sparse reads, cursor pages and an included projection. Its concatenation
expression now selects MySQL `concat` versus SQLite/PostgreSQL `||`, while
retaining the explicit warning that arbitrary projection SQL is dialect-specific.
Detailed projection dependency, cursor and visibility contracts remain intact.

The default 25-scenario tutorial run passes
(`/tmp/library-projection-guide.log`, 28088). All six native jobs also pass
(`/tmp/library-projection-guide-native.log`, 74517): **72 SQL tutorial
scenarios**, plus six repeated no-storage checks, zero failures/skips. The new
projection scenario verifies exact full names, sparse output, derived ordering
across two cursor pages and included output on SQLite/PostgreSQL/MySQL and both
storage modes. No runtime source changed.

The preceding migration status corrections passed docs
(`/tmp/library-migration-status-docs.log`, 22260) and whitespace checks. The
broader prose reconciliation remains open; executed examples do not prove every
surrounding claim or every possible custom projection expression.


## 2026-09-11: Migration status and file/version ownership reconciliation

**132/214 complete; 82 open.** Corrected stale migration-guide status claims
against completed A7-09/B2/B3 evidence. Core managed transactions and file/event
completion are implemented; consumer transaction migration remains paused.
Multi-upload, replacement and deletion checks are complete under the selected
file-lifetime contract: committed objects are application-owned, while confirmed
rollback cleans new uploads. The migration guide now links directly to that
contract instead of calling the coverage unfinished. The version-field guide
now distinguishes implemented revision/HTTP-validator behavior from unfinished
consumer adoption, removing its stale claim that validators/invalidation were
not yet complete.

Reviewed CORS guide options and transport-boundary prose against the current
configuration/connector contracts; no change was needed in this pass. These
are prose corrections, not new runtime capabilities or newly completed consumer
work. The preceding A10-04 acceptance record passed docs
(`/tmp/library-documentation-execution-docs.log`, 57689) and exact checklist
recount: A97/138, B33/48, M2/14, C0/14.


## 2026-09-11: Representative documentation execution; A10-04 complete

**132/214 complete; 82 open. A97/138, B33/48, M2/14, C0/14.** The selected
After snippets are extracted from the actual migration guide, not copied into
tests. The checker supplies fresh resources and contextual variables, selects
new syntax after the Before/After marker, and captures results. It verifies
plain GET, sparse JSON:API query, explicit plain POST, none/full PATCH,
relationship add/replace/remove with membership checked after each call, and
a managed resource write plus raw audit insertion. Repeating that transaction
snippet with a missing audit table verifies resource rollback on SQL failure.

Both default SQLite modes pass (`/tmp/library-migration-guide-examples.log`),
then all six SQLite/PostgreSQL/MySQL storage jobs pass on Node 24
(`/tmp/library-migration-guide-native.log`, 40299), with six zero-failure
summaries. Scoped lint passes (85082). The packed gate passes
(`/tmp/library-migration-guide-package.log`, 42019): 152 files, 227 local links,
27 runtime exports, 10 negative declaration checks, and actual packed imports
for the examples' bulk plugin and local storage class. Artifact SHA1:
`739782d9c2e2c35dfc68cc6b940bb186bd159aaf`.

A10-04 requires representative documentation and migration examples covering
imports, configuration, outputs, hooks and supported drivers/connectors. Its
acceptance evidence now comprises:

- Existing API-reference, quickstart, setup and relationship-guide runners,
  including actual configuration/output checks and HTTP CRUD.
- 66 SQL tutorial scenarios over all six driver/storage combinations, including
  transformations, hook ordering, policies, relationship endpoints, bulk,
  temporal values and real Fastify injection; separate no-storage service calls.
- Actual standalone servers and the file/Socket.IO guide setups on Express 5/4,
  with multipart/file cleanup and real Socket.IO client protocol assertions.
- Six native migration-snippet scenarios, plus existing executed temporal and
  resource-version migration examples and their conformance evidence.
- Extracted tarball imports, declaration/runtime agreement and local doc links.

This closes the representative execution item, not the entire prose audit or
all possible snippet/backend combinations. Source imports injected by individual
runners remain distinguished from packed import checks. No live consumer port,
external service, browser workflow or real S3 verification is implied. A10-01,
A10-02, migration tasks and final review remain open. The Socket.IO runner also
passed lint (48897), docs (`/tmp/library-socket-guide-docs.log`, 36271) and
whitespace checks before this acceptance pass.


## 2026-09-11: Socket.IO guide with a real client

**131/214 complete; 83 open.** Added `test:socket-guide`, executing the guide's
actual public server setup with corresponding local imports and an allocated
port. Real Socket.IO clients use the documented API-prefixed path and
subscription protocol. Both installed Express 5 and selected Express 4 pass
on Node 24 (`/tmp/library-socket-guide.log`,
`/tmp/library-socket-guide-express4.log`).

Assertions cover subscribe acknowledgement, duplicate ID rejection, matching
creation, nonmatching suppression, leaving/entering the query result, deletion
with identifier-only deletedRecord, unsubscribe suppression and restoration.
The existing acknowledgement barrier drains earlier packets for negative
assertions; fixed sleeps are not used. Clients disconnect, Socket.IO closes
its HTTP server, and SQLite is destroyed in finally cleanup. This executes
the literal server setup; client protocol calls are matching checker actions,
not evaluation of the browser-style event-handler snippet. Redis/authenticated
and canonical cases retain their separate existing integration evidence.

The preceding file-guide runner passed scoped lint (71310), docs
(`/tmp/library-file-guide-docs.log`, 15584) and whitespace checks.
Representative migration-fragment execution remains under A10-04.


## 2026-09-11: File guide executed with both Express versions

**131/214 complete; 83 open.** Added `test:file-guide` to execute the file-upload
guide's actual complete setup. The checker injects corresponding local imports,
an allocated port and a temporary upload directory, leaving its other setup
statements unchanged. Both installed Express 5 and explicitly resolved Express 4
pass on Node 24 (`/tmp/library-file-guide.log`,
`/tmp/library-file-guide-express4.log`).

Each run verifies multipart creation, JSON:API attributes and file URL, exactly
served PNG bytes, 422 MIME rejection, 422 required-title rejection after file
processing, no extra files after rejection, the retained committed file and one
stored resource. Finally closes the listening server, destroys SQLite and
removes the temporary directory. This executes ordinary SQLite/Busboy/local
storage; it does not add canonical, native, Formidable or real S3 coverage.
No runtime source changes were needed for this guide.

The preceding native tutorial runner passed scoped lint (51194), docs
(`/tmp/library-tutorial-native-docs.log`, 92116) and whitespace checks.
Socket.IO and representative migration-fragment execution remain under A10-04.


## 2026-09-11: Native execution of the tutorial corpus

**131/214 complete; 83 open.** The tutorial checker now uses the existing
`createTestDatabase` fixture, including isolated native databases and awaited
cleanup. It honors an explicitly selected storage mode while retaining both
modes in its standalone default run. It no longer silently fixes database
verification to SQLite. Added `test:tutorial-guides:databases`, reusing the
existing disposable database harness without a second provisioning layer.

The unchanged result assertions pass the default 23 scenarios
(`/tmp/library-tutorial-driver-fixture.log`, 55501), then all six native
jobs (`/tmp/library-tutorial-native.log`, 54763): SQLite/PostgreSQL/MySQL,
ordinary/canonical. There are **66 SQL tutorial scenarios** (11 guides in
six combinations), plus the no-storage service scenario repeated six times:
72 logged successes, six passing script summaries, zero failures/skips.
The Node 24 runner used the previously provisioned PostgreSQL 16/MySQL 8
binaries and exited successfully through its cleanup path.

Coverage includes searching, pagination, relationships endpoints, transformations,
hooks, autofilter, plugin registration, PUT/PATCH, bulk, temporal values and
Fastify injection. Fastify requests run against each selected real database.
The same literal example statements execute; only fixture initialization and
result assertions are supplied by the checker. Import statements are injected
from the corresponding local modules, so tarball import checks remain separate.
This does not execute every migration-guide fragment or the file/Socket.IO
guides; A10-04 remains open for the remaining representative integration work.

The preceding Fastify guide passed scoped lint (78085), docs
(`/tmp/library-fastify-guide-docs.log`, 26055) and whitespace checks.


## 2026-09-11: Fastify guide HTTP execution

**131/214 complete; 83 open.** The Fastify guide now supplies three executable
blocks after documented REST/storage setup, including resource declaration,
real Fastify injection and awaited shutdown. All 23 tutorial scenarios pass on
Node 24 (22 SQLite guide/mode combinations and one service case),
`/tmp/library-fastify-guide-examples.log`, 85778.

The eight new injected requests across both storage modes verify 201 JSON:API
creation despite plain programmatic defaults, correct response media type,
numbered count, 422 required-title rejection, 400 malformed JSON and error
documents. Follow-up resource reads prove only the successful request stored a
record. Injection exercises the real Fastify router/parser/handlers without a
listening socket; it does not claim new native database or browser coverage.

The preceding bulk tutorial passed scoped lint (62504), docs
(`/tmp/library-bulk-guide-docs.log`, 24424) and whitespace checks. The guide's
retained version-conditions anchor remains valid. No runtime implementation or
consumer source changed in this step.


## 2026-09-11: Bulk tutorial ownership and response consolidation

**131/214 complete; 83 open.** Consolidated the bulk guide into seven executable
blocks and retained its detailed version-condition and diagnostic contracts.
Corrected stale statements that managed completion/file-event integration had
not been implemented. The guide distinguishes network batching from sequential
resource writes, documents compacted successful data versus indexed errors,
and links outcome rules instead of suggesting unconditional retries.

All 21 tutorial scenarios pass on Node 24 (20 SQLite guide/mode combinations,
one service case), `/tmp/library-bulk-guide-examples.log`. New assertions cover
POST ordering/counts, minimal PATCH identifiers, non-atomic failure index and
rollback outcome, atomic rollback without undoing earlier calls, outer managed
rollback, and deletion IDs/final survivors. The plugin uses its existing deep
import; an initial draft assumed a nonexistent index export and execution
caught that mistake before the guide was finalized. HTTP body mappings were
reviewed against the connector registration; these new examples exercise the
programmatic API rather than adding HTTP/native coverage.

The preceding navigation changes passed docs
(`/tmp/library-guide-navigation-docs.log`, 27569) and whitespace checks.
Broader documentation and migration acceptance remains open.


## 2026-09-11: Guide navigation and supported-runtime reconciliation

**131/214 complete; 83 open.** Reconciled the guide index with the rewritten
chapters: Node 24+, custom service methods versus built-in storage, paused
positioning, temporal examples, migration status and version-field migration.
The relationship overview now maps to the verified scenarios and tells readers
to start each from a fresh database. Removed broad claims that the individual
chapters demonstrate all possible relationships. Corrected the README logging
option and connector feature description, and removed the Fastify guide's
stale current-runtime claim of Node 22.

These are navigation and wording changes; no new runtime behavior is claimed.
The preceding temporal appendix passed scoped lint (81543), docs
(`/tmp/library-temporal-guide-docs.log`, 69268) and whitespace checks. Installed
mysql2 configuration source confirms `Z` is accepted while `UTC` is not a valid
timezone configuration spelling.


## 2026-09-11: Temporal appendix executable filters and values

**131/214 complete; 83 open.** Added three literal temporal tutorial blocks and
replaced unsupported `filters[field][$gte]`/`$lt` HTTP examples with declared
search aliases and the singular HTTP `filter` key. The scenario covers date,
offset dateTime, time and epochMilliseconds values plus equality and inclusive
range queries. Clarified that timezone offsets are accepted and changed the
MySQL connection fragment to the driver's `Z` timezone spelling. Existing
precision and final-normalization limitations remain documented.

All 19 tutorial scenarios pass on Node 24 (18 SQLite guide/mode combinations,
one no-storage service example), `/tmp/library-temporal-guide-examples.log`,
77719. The temporal assertions check exact normalized values and query results;
they do not establish new native driver coverage or execute every configuration
fragment. The broader documentation checklist remains open.

The preceding custom-storage correction passed scoped lint (40434), docs
(`/tmp/library-service-docs.log`, 59018), and packed types/content/link checks
(`/tmp/library-service-package.log`, 42411): 152 files, 212 local links,
27 exports and 10 negative checks, SHA1
`0aeb5ca79d5f26ecb1272a557413346f4ca7a0c2`.


## 2026-09-11: Custom-storage guide corrected against executable source

**131/214 complete; 83 open.** Executing the former guide's complete Map
plugin and its first resource POST fails with `No transaction factory is
installed` (`/tmp/library-custom-storage-before.log`). Source review additionally
shows direct adapter/Knex relationship and lock dependencies, so implementing
eight CRUD helpers does not establish the advertised complete backend.

Replaced the misleading Map/remote-storage implementations with the actual
integration boundaries: in-memory SQLite for built-in CRUD, canonical SQL,
explicit custom service methods, and the requirements of a new core storage
integration. This changes documentation, not the available runtime capabilities.
The guide does not promise automatic CRUD permissions, JSON:API formatting,
HTTP routing or transactions for custom methods.

Its three literal blocks run without a database plugin. Assertions cover the
result, denied authorization, invalid input, a second SKU result and absence
of Knex state. The tutorial runner now supports this explicit no-storage case;
all 17 scenarios pass (16 SQLite guide/mode combinations plus one service case)
on Node 24 (`/tmp/library-service-guide.log`, 83367). The broader storage and
documentation requirements remain open; no generic backend was implemented.

The preceding PUT/PATCH guide changes passed scoped lint (63481), docs
(`/tmp/library-put-patch-docs.log`, 3919) and whitespace checks.


## 2026-09-11: PUT/PATCH guide replacement semantics

**131/214 complete; 83 open.** Replaced the contradictory PUT/PATCH tutorial,
which still used top-level plain writes, backing-field relationship input and
a summary claiming omitted persisted values clear automatically. The new six
literal blocks cover PATCH retention, typed incomplete-PUT rejection and
rollback, explicit nullable clearing, the PUT relationships-object boundary for
has-many membership, surviving detached children and PATCH reattachment.
The guide also links to the owning relationship, lifecycle and version contracts.

All 16 tutorial/storage combinations pass on Node 24
(`/tmp/library-put-patch-guide.log`). The new assertions inspect exact linkage,
remaining record values and the typed rollback outcome in both SQLite modes.
An initial draft used `relationship` instead of `relationshipName`; executing
it exposed that mistake and the final literal example is corrected. General
many-to-many/has-one statements were reviewed against the PUT implementation;
this example specifically executes belongs-to and has-many changes, not every
relationship kind or native driver. Broader guide acceptance remains open.

The preceding example-checker refactor passed lint after removing unnecessary
property quotes (50651) and docs
(`/tmp/library-server-examples-docs.log`, 62677).


## 2026-09-11: QuickTest and consolidated example verification

**131/214 complete; 83 open.** Extended the existing child-server checker to
run `quickTest.js`, renamed it to `check-server-examples.js`, and exposed the
combined `npm run test:server-examples` command. The earlier URL-only command
was an unpublished intermediate script and is replaced without an alias.
QuickTest now uses the supported `logging.level` configuration.

The actual child programs pass 17 HTTP requests on Node 24
(`/tmp/library-server-examples.log`, 33896): the prior 12 URL requests plus
QuickTest's publisher seeds, included patched author, cross-table filter,
empty name filter and belongs-to linkage. All three child processes exit.
This remains ordinary SQLite/installed Express coverage, not an additional
native or canonical matrix.

The tutorial checker now stores filename, returned result names and expected
executable-block count together for each guide, replacing its long conditional
expression. Changed block counts require explicit review instead of silently
reducing executable coverage. All 14 guide/storage combinations still pass
(`/tmp/library-tutorial-map.log`, 63255).

The preceding standalone URL changes passed explicit non-ignored example/script
lint (84054) and docs (`/tmp/library-url-example-docs.log`, 49714).
Broader documentation/migration acceptance remains open.


## 2026-09-11: Standalone URL override example

**131/214 complete; 83 open.** Repaired the standalone URL example to use a
named transport hook and `context.request`, rather than a nonexistent top-level
`req` hook argument. It imports the local library from the source checkout,
uses the connector mounting helper, reports the allocated port, and handles
SIGTERM/SIGINT shutdown. Configured header URLs are explicitly selected from a
small allowlist; tenant host matching is exact. Default response links are
relative, as the transport contract specifies, rather than the example's old
claim of host-derived absolute URLs.

`npm run test:url-example` starts the actual example as a child process with
an allocated port in ordinary SQLite/Express. Twelve HTTP requests pass across
production override disabled/enabled (`/tmp/library-url-example.log`, 62728):
default, configured CDN, version header, tenant Host, unconfigured URL fallback,
and JSON:API POST with the selected response URL. The checker uses Node HTTP
for Host-header cases because fetch did not send that override. Both children
exit after SIGTERM; timeout cleanup escalates only for a non-exiting child.
No browser or consumer repository is involved. Canonical/other connector
coverage is not claimed for this particular example.

The preceding final packed navigation gate passes 201 local links, 152 files,
27 exports and 10 negative declaration checks (`/tmp/library-doc-links-final.log`,
1773), SHA1 `1d299cabfac9e493e58946a8eed2843297d61dea`.
Scoped lint (10335), docs (`/tmp/library-doc-links-docs.log`, 63890) and whitespace
checks also passed for that documentation batch.


## 2026-09-11: Packaged documentation navigation

**131/214 complete; 83 open.** The packed-package gate now checks local inline
Markdown link targets in the extracted tarball, outside fenced code. Before
correction it rejects 23 links to excluded development/tests documents
(`/tmp/library-doc-links-before.log`, 60539). The version-field migration guide
has moved into `docs/GUIDE`, with repository references updated. Lifecycle
links now use the shipped hook guide. Contributor evidence, the example
backfill script and parked patches are explicitly identified as source-checkout
references rather than links to absent package files. Development notes and
tests remain excluded from publication.

The first corrected tarball passes 202 local inline-link checks, packed public
types, 27 exports and 10 negative declaration checks
(`/tmp/library-doc-links-after.log`, 71923). This check covers local file
targets, not heading anchors, external URLs, reference-style Markdown or HTML
links. The broader consolidation and example-execution criteria stay open.
No runtime implementation or consumer repository changed.

The preceding plugin tutorial passed scoped lint (67895) and docs
(`/tmp/library-plugin-docs.log`, 56350).


## 2026-09-11: Plugin tutorial and extension boundary review

**131/214 complete; 83 open.** The plugin-writing guide now has a runnable
registration/custom-resource-method example. Its three literal blocks pass in
both SQLite storage modes, asserting distinct enabled/disabled resource state.
All 14 tutorial/storage combinations pass on Node 24
(`/tmp/library-plugin-examples.log`). Corrected registration-time options to
use `context.scopeOptions`, separated schema enrichment from other resource
registration work, and distinguished early request processing from later
attribute validation. Removed the raw workspace-column filtering example,
which ignored mapped/canonical columns, in favor of the existing documented
autofilter, row-policy and custom-search contracts. Remaining snippets are
explicit install-function fragments; the runnable checker does not execute them.

The preceding autofilter step also passed scoped lint (86727) and the docs
build (`/tmp/library-autofilter-docs.log`, 18200). No runtime source changed
in either documentation step. Package navigation and the broader documentation
acceptance criteria remain open.


## 2026-09-11: Autofilter tutorial and remaining option examples

**131/214 complete; 83 open.** Replaced the four remaining `simplified: false`
examples in the autofilter/row-policy guides with `format: 'jsonapi'`. Corrected
the autofilter relationship example to supply the session/subject context its
configured resolvers actually read. A guide search now finds no `simplified:`
or `returnRecord:` option examples outside the intentionally historical API
migration guide; this search alone does not establish the whole documentation
contract as complete.

Added three runnable autofilter blocks and extended the existing tutorial
checker. All 12 guide/storage combinations pass on Node 24
(`/tmp/library-autofilter-examples.log`). Autofilter assertions cover create
stamping, scoped count and records, PUT scope retention, the other workspace's
visibility, typed mismatch rollback with unchanged visible records, and the
missing-context error code. The example uses SQLite in both storage modes;
it does not claim additional native coverage. No runtime implementation changed.
The broader guide/plugin and package-navigation audits remain open.


## 2026-09-11: Executable hook guide and lifecycle correction

**131/214 complete; 83 open.** Replaced the stale hook reference with the
selected resource/read/relationship/bulk lifecycle, boundary-specific context
shapes and managed completion semantics. Removed examples of write hook names
that resource methods do not invoke, the claim that every hook receives an
input document, and unsupported shared-context assumptions. Retained the
relationship lock and registration-time schema enrichment contracts. The
broader plugin reference and remaining guide audit are still open.

The three literal example blocks now run through `test:tutorial-guides` in
both SQLite storage modes. Assertions verify normalized stored titles, exact
observed POST validation/write/nested-GET/finish/commit sequences, and minimal
response shape with no nested GET. All ten guide/mode combinations pass on
Node 24 (`/tmp/library-hooks-examples.log`). This small example does not replace
the existing full lifecycle and native conformance matrices.

Whole lint passes (`/tmp/library-hooks-lint.log`, 33041), the docs build passes
(`/tmp/library-hooks-docs.log`, 17575), and packed public types/content pass
(`/tmp/library-hooks-package.log`, 43737): 151 files, 444562 packed bytes,
27 exports and 10 negative checks, SHA1
`0970f87125335b7d0e5fbfe1567d1b4589990910`.
Whitespace validation passes. No runtime source changed in this step; the
previous accumulated full gate remains the latest full-suite evidence.


## 2026-09-11: Executable transformation guide consolidation

**131/214 complete; 83 open.** Consolidated the duplicated transformation guide
into one runnable categories/products scenario while retaining the detailed
compiled dependency contract and corrected callback-context tables. Removed
obsolete api.on lifecycle names, raw relationship backing-field writes, top-level
write shorthand and simulated password-hashing snippets. The new examples cover
trim setters, an awaited getter, getter ordering, chained computed dependencies,
hidden/normallyHidden output, sparse primary and included records, virtual input
non-persistence, minimal PATCH and a typed post-validation hook failure.

The existing tutorial checker now executes all five literal transformation blocks
in both SQLite modes, plus the other three guides. All eight guide/mode
combinations pass (`/tmp/library-transformations-examples.log`, 12283). Assertions
also inspect stored name/code to distinguish setters from getter-only output and
verify the hook's typed cause/rolledBack outcome. The js-labelled dependency
fragment is explanatory and not executed by this checker; dependency graph
behavior has separate conformance coverage. This does not prove every prose
claim or every backend/connector and leaves broader A10 acceptance open.
No runtime or consumer code changed in this documentation step. The prior
callback-context docs build completed successfully (5859).

Scoped lint passes (57723); docs build passes
(`/tmp/library-transformations-docs.log`, 67913). Packed contents/public types
pass (`/tmp/library-transformations-package.log`, 67349): **151 files, 453,067
packed bytes, 27 exports, 10 negative checks**, SHA1
`c06d30d7faa381c2620a99ba35847f3c0f0acfe4`. Diff checks pass. The existing inbound
migration-guide dependency-contract anchor remains present.


## 2026-09-11: Relationship declaration-order follow-up

**131/214 complete; 83 open.** A further lookup review reproduced one priority
regression when manyToMany was declared before an existing hasMany to the same
target (`/tmp/library-search-path-priority-before.log`, four pass/one fail).
The search now detects existing hasMany/belongsTo paths before considering the
new manyToMany fallback, independent of declaration order. The focused join and
membership tests pass **9/9 in each SQLite mode**
(`/tmp/library-search-path-priority-knex.log`,
`/tmp/library-search-path-priority-anyapi.log`); scoped lint passes (95281).
This small runtime follow-up postdates the full gate below. It does not inherit
that artifact's verification. No full suite was repeated for this follow-up.

The field-transformation guide's callback tables now match setterContext,
getterContext and computeContext in source. Corrected the distinction between
ID and record attributes, request context location, needed-field computation,
missing PATCH input and virtual non-persistence. Removed unsupported api.on
transformation examples in favor of links to the actual hook and output-field
contracts. The detailed dependency contract and later examples remain intact;
those examples still require their own reconciliation/execution. This is a
partial guide correction, not completion of A10-01/A10-04. No consumer changed.
The prior tutorial evidence docs build completed (84033).

## 2026-09-11: Accumulated search and tutorial verification

**131/214 complete; 83 open.** Node 24 npm run verify completed successfully
(`/tmp/library-many-search-full-verify.log`, 47736). This covers the many-to-many
lookup, canonical link-search source, preserved direct-path precedence and
multilevel alias fixes, together with the previously applied tutorial changes.

| Stage | Result |
| --- | --- |
| Ordinary SQLite | 5,742 pass, zero failures, one existing skip; 309.165 s |
| Canonical SQLite | 5,809 pass, zero failures/skips; 354.012 s |
| Express 4 ordinary | 458 pass; 34.823 s |
| Express 4 canonical | 460 pass; 34.163 s |
| Internal/public types, packed contents, query budgets, whole lint, docs | Pass |

**12,469 passing tests, zero failures, one existing skip.** The package is the
151-file artifact with SHA1 `3e4ce3efee3f795b39bcf1c12f7e06de459fe6a0`.
The separate 24-check native result above covers focused search behavior, not
all full-suite cases on native drivers. Consumer migration and final reviews
remain open.

While the gate ran, three tutorial drafts were prepared and executed outside the
source tree. Searching now has explicit records and correct nullable PUT behavior;
the first draft wrongly omitted populated fields, which complete-replacement
validation rejected. The corrected example clears them explicitly. Pagination
now owns its examples and links to the separate projection guide instead of
copying it. Relationship URLs use actual methods and relationshipData, without
an invented standalone plugin or implicit reverse relationship creation.
All six draft/mode combinations passed (`/tmp/library-three-tutorial-drafts.log`,
38382). After the gate ended these three drafts and a repository-relative
`test:tutorial-guides` checker were applied. They require their own applied-source
checks and do not inherit the full gate's artifact hash. A10-01/A10-02/A10-04
remain open for remaining guides, packaged links and broader examples.

Applied-source `test:tutorial-guides` passes all six combinations
(`/tmp/library-applied-tutorial-guides.log`). Scoped lint and diff checks pass
(26081). Docs build passes (`/tmp/library-tutorial-batch-docs.log`, 57912).
Packed contents/public types pass (`/tmp/library-tutorial-batch-package.log`,
72334): **151 files, 459,564 packed bytes, 27 exports, 10 negative checks**,
SHA1 `786e3c1903d3b2af534493f85a05b58d2b86c88c`. No runtime changes followed the
full gate. Source navigation audit found no missing local targets but 23 links
to repository-only material outside the npm allowlist; this remains A10-02 work
(`/tmp/library-current-doc-navigation-audit.json`).


## 2026-09-11: Multilevel pivot join and visibility review

**131/214 complete; 83 open.** Four focused join-chain regressions reproduced
incorrect alias selection after a many-to-many step: the next belongsTo,
hasMany, polymorphic hasMany or second pivot referenced the first pivot instead
of its target (`/tmp/library-multilevel-join-before.log`, 0/4). Join construction
now selects the last emitted join rather than indexing joins by relationship
path position. This accommodates the two joins emitted for a pivot.

The search conformance fixture also now asserts pivot row filtering and query
permission for ordinary storage, while canonical link membership remains
independent of pivot resource rows, as already documented. Both selected SQLite
runs pass 8/8 (four conformance plus four join-builder checks):
`/tmp/library-many-search-review-knex.log` (4563) and
`/tmp/library-many-search-review-anyapi.log` (12156). The four conformance cases
pass all six database/storage combinations: **24/24**, no failures/skips
(`/tmp/library-many-search-review-native.log`, 92561), including the latest
relationship precedence and join-builder source. The multilevel assertions are
join-builder unit checks, not real multilevel SQL execution.

Both query-budget invocations pass (`/tmp/library-many-search-budgets.log`, 8639).
Scoped lint passes (82574), internal types pass (81961), and diff checks pass.
The preceding relationship-guide run passed all seven declared guide/mode
combinations (85399), and its docs build passed (34464). Full accumulated
verification remains due; no consumer repository changed. Packed contents and
public types pass (`/tmp/library-many-search-package.log`, 27176): **151 files,
468,253 packed bytes, 27 exports, 10 negative checks**, artifact SHA1
`3e4ce3efee3f795b39bcf1c12f7e06de459fe6a0`.


## 2026-09-11: Storage-aware many-to-many search correction

**131/214 complete; 83 open. Further search review remains required.** Canonical
search now reuses buildRelatedLinkQuery via a query dependency, projecting link
parent/child IDs into the pivot field columns expected by the shared join builder.
The existing link query retains tenant, relationship, target-type and both stored
orientation constraints; its all-parent mode is explicit and default-off. Target
query permission and row filters remain in the shared target join. Ordinary
storage continues to read/filter actual pivot rows.

The new regression includes inverse-created membership, target row exclusion and
permission rejection. All three cases passed on all six SQL/storage combinations
(18 checks, `/tmp/library-many-search-native.log`, 21468). Broader SQLite tests
then exposed six regressions per mode: newly recognized membership paths took
precedence over an existing direct belongsTo path to the same target. Restored
that established direct relationship precedence. Afterward both selections pass
**195/195** (`/tmp/library-many-search-priority-knex.log`, 16203;
`/tmp/library-many-search-priority-anyapi.log`, 37892). Internal types (3040),
scoped lint (36454), and diff checks pass. Native evidence predates the precedence
correction; no final full gate is claimed.

The many-to-many tutorial now explicitly scopes direct pivot metadata operations
to ordinary storage, matching the existing migration contract. Its checker runs
that guide in ordinary mode; canonical membership search is covered by the
separate conformance cases, not a false pivot-row equivalence. Remaining review
includes multilevel join chains after a pivot, query budgets, ordinary pivot
visibility and final artifact/docs checks. No consumer repository changed.

## 2026-09-11: Isolated canonical membership-search regression

**131/214 complete; 83 open. The many-to-many runtime fix remains unfinished.**
Added conformance-many-to-many-search using the existing query fixture with its
parallel hasMany path removed. This forces cross-table filtering through an
aliased manyToMany relationship, with two matching children, distinct count and
last-membership removal. The draft ordinary lookup fix passes both tests
(`/tmp/library-many-search-regression-knex.log`). Canonical storage passes removal
but fails the attached-parent test: empty results instead of the matching parent
(`/tmp/library-many-search-regression-anyapi.log`). No tests were skipped or
weakened to accommodate this defect.

Source tracing found the existing buildRelatedLinkQuery in the canonical plugin,
which unions both stored orientations and scopes by tenant, relationship and
resource types. Existing migration documentation explicitly distinguishes
canonical links from separately declared pivot rows and their policies. The
pending fix should reuse that link source for search membership and retain target
resource search visibility. Ordinary pivot filters remain applicable to ordinary
storage. The draft tutorial's direct pivot metadata section must also be scoped
to ordinary storage instead of claiming canonical link/pivot-row equivalence.
The prior draft docs build passed (60403); this does not validate failing runtime
behavior. No consumer repository changed.

## 2026-09-11: Many-to-many tutorial exposes unfinished search defects

**131/214 complete; 83 open. Current many-to-many work is NOT verified.**
The draft guide replaces legacy input/format calls and pivot foreign-key inputs
with public relationship aliases, declares the pivot filter, and adds checked
membership removal and retained pivot metadata. The shared relationship checker
now includes its five blocks.

The initial execution failed on ordinary storage with "No searchable relationship"
(`/tmp/library-manytomany-guide.log`). buildJoinChain recognized hasMany-with-through
but never the public manyToMany declaration. A small draft runtime correction
now recognizes manyToMany using its explicit target or relationship-name fallback,
reusing the existing pivot-chain construction. With that change the ordinary
SQLite tutorial passes. Canonical SQLite still fails: booksByNeil has zero
records instead of two (`/tmp/library-manytomany-guide-fixed.log`). The search
join currently reads the pivot resource source, whereas canonical relationship
membership uses separate link storage. This requires storage-aware pivot search
and focused regression tests, including authorization/visibility and custom
mapping, before accepting the runtime patch. Do not count the tutorial or search
fix complete, and do not attribute previous full-gate results to this draft.
No consumer repository changed. The previous polymorphic docs build completed
successfully (`/tmp/library-polymorphic-guide-docs.log`, 45678).

## 2026-09-11: Polymorphic tutorial identity and search examples

**131/214 complete; 83 open.** Reconciled the polymorphic hasMany tutorial into
five sequential blocks using explicit inputRecord, format and relationshipData.
Retained and executed forward polymorphic search and reverse review filtering,
with indexed target fields and exact declared type mappings. Removed duplicate
resource registration and old shorthand/format examples. The example explicitly
creates a publisher and author with the same ID, includes them independently,
and moves a review by changing only its target type. Required linkage and plain
_type versus JSON:API type representations are explained.

The existing relationship-guide checker now covers all fifteen blocks across
three guides in both SQLite storage modes. All six combinations pass on Node 24
(`/tmp/library-polymorphic-guide.log`, 24354). Assertions check same-ID separation,
included identities, forward/backward filtering and inverse membership after a
type-only move. Scoped lint passes (51560). HTTP shell examples and native-driver
execution remain outside this check; broader documentation acceptance stays
open. No library runtime or consumer source changed. Package checks are deferred
to the next documentation batch, so the last artifact predates this guide change.
The prior hasMany evidence docs build also completed (35048).

## 2026-09-11: hasMany tutorial and shared example checker

**131/214 complete; 83 open.** Replaced the hasMany guide's obsolete shorthand,
undefined example variable, contradictory JSON:API linkage descriptions and
mislabelled filter example. The sequential guide now demonstrates identifier
reads, plain/JSON:API includes, empty collections, sparse child fields, numbered
getRelated pagination, filtering in both directions and add/remove/replace
membership. It explicitly distinguishes unlinking a nullable child from deleting
that child and parent pagination from related-resource pagination.

Extended and renamed the existing checker to `scripts/check-relationship-guides.js`
and `npm run test:relationship-guides`, replacing the narrower belongsTo command.
All ten literal JavaScript blocks execute in both SQLite storage modes, with
assertions for each documented result and retained detached authors. Final run
passes all four guide/mode combinations (`/tmp/library-relationship-guides.log`,
77102); scoped lint passes after automatic indentation formatting (89105).
HTTP shell examples and native-driver guide execution are outside this check.
No runtime library or consumer source changed; broad docs/example items remain
open. The previous belongsTo docs build and local-link checks also passed
(`/tmp/library-belongsto-guide-docs.log`, 12400; lint 20760).

Current docs build passes (`/tmp/library-hasmany-guide-docs.log`, 66447), and
packed contents/public types pass (`/tmp/library-relationship-guides-package.log`,
8361): **151 files, 473,969 packed bytes, 27 exports, 10 negative checks**,
SHA1 `86b1dd6de7f942331ee1ed7db420c59da103114f`. This artifact includes both
relationship guide revisions. Local link targets and diff checks pass.


## 2026-09-11: belongsTo tutorial execution

**131/214 complete; 83 open.** The starting-point chapter now distinguishes
logical schema fields from physical storage columns and hook-stage context.
Removed claims that hooks universally receive raw columns. The belongsTo guide
now has sequential executable examples with explicit inputRecord, format and
queryParams, relationship linkage selected in sparse fieldsets, ID/related-code/
null filters, and resource versus relationship-only writes. Replaced stale
large output dumps with checked response descriptions.

New `npm run test:belongsto-guide` executes all five literal JavaScript blocks
in both SQLite storage modes and checks linkage, includes and JSON:API included
identity deduplication, sparse fields, the three filters and cleared linkage.
During execution the draft omitted indexed:true required for cross-table code
filtering, used inputRecord instead of relationshipData for patchRelationship,
and incorrectly expected null properties in plain records. Those draft errors
were corrected against runtime/source evidence: plain conversion omits null
to-one linkage; getRelationship returns a linkage document with data:null.
Final command passes in both modes (`/tmp/library-belongsto-guide-final.log`).
No library runtime code changed. The shell HTTP examples are not executed by
this checker; broader guide/API reconciliation stays open. No consumer source
changed. Packed verification is deferred to the next documentation batch; the
preceding setup-guide artifact does not include this revision.

## 2026-09-11: Initial setup guide reconciliation

**131/214 complete; 83 open.** Replaced obsolete setup/response/HTTP sections
with the implemented format/returning and explicit-inputRecord contracts.
The standalone countries example no longer declares relationships to resources
that are absent from that example. Logging uses logging.level, SQLite uses the
installed better-sqlite3 driver, and the query default is correctly 20. HTTP
examples now describe generated JSON:API/full responses, POST 201, PUT/PATCH 200
and body-free DELETE 204. Removed invented helper signatures and duplicated
obsolete option maps. Existing logical-ID/storage-column and normalization
examples are retained; managed transactions, backend limits and schema helpers
link to their owning contracts. Fastify is described as available.

`npm run test:setup-guide` executes the literal complete SQLite example and
asserts its printed values, then executes the alternate response configuration
with storage/table setup inserted at the required points. It checks call-level
none/minimal overrides and the resource-level full override. The first harness
run selected the initial block twice and failed on its import syntax; corrected
the selector to match the alternate plugin configuration. Final command passes
(`/tmp/library-setup-guide-final.log`). PostgreSQL/MySQL connection snippets and
retained advanced ID examples are not executed by this command. No runtime or
consumer source changed. A10-01/A10-04/B0-08 remain open for the other guides and
broader required example coverage.

Docs build passes (`/tmp/library-setup-guide-docs.log`, 1399). Packed contents
and public types pass (`/tmp/library-setup-guide-package.log`, 34869): **151 files,
476,406 packed bytes, 27 exports and 10 negative checks**, SHA1
`7482272784b90916ef75ec96175c03fcae692b82`. Scoped lint passes after correcting
one quote-style issue (14250); the example command passes again afterward.
Diff checks pass. The full runtime suite was not repeated for documentation.

## 2026-09-11: Executable quickstart correction

**131/214 complete; 83 open.** The quickstart now uses explicit inputRecord,
format/returning and queryParams, including filters, includes and numbered
pagination. Removed unsupported top-level write shorthand, misplaced query
options, legacy offset/limit parameters and stale sample output. Installation
now states Node 24+ and the unpublished-contract/tarball requirement. curl
examples disable globbing for bracketed query names. The complete server
example includes connection cleanup on shutdown.

New `npm run test:quickstart` executes all three literal JavaScript blocks,
substituting an allocated listening port and injecting their imported modules.
It verifies actual responses for plain CRUD, relationship includes,
filtering, numbered pagination, minimal returns and JSON:API creation, then
checks six HTTP reads and POST/PATCH/DELETE followed by 404 through real Express.
The HTTP requests mirror the shell examples; the shell commands themselves
are not executed. SQLite ordinary storage and the installed Express version
are this example's scope, not a backend/connector matrix or a clean installation.
The first run passed (`/tmp/library-quickstart-check.log`). Scoped lint initially
reported two property-line formatting issues, corrected before final checks.
Final `npm run test:quickstart` passes (`/tmp/library-quickstart-final.log`,
58403). Scoped lint and diff checks pass. Documentation builds successfully
(`/tmp/library-quickstart-docs.log`, 22197). Packed contents/public types pass
(`/tmp/library-quickstart-package.log`, 26203): **151 files, 481,773 packed bytes,
27 runtime exports, 10 negative checks**, artifact SHA1
`34ac759d62ae92817f3b2131ce9cf419c865b5c9`.
No runtime library code or consumer checkout changed. Broader guide/example
reconciliation remains open under A10-01/A10-04/B0-08.

## 2026-09-11: Published transaction contract consolidation

**131/214 complete; 83 open.** The managed-transaction and transaction-outcome
contracts now live under docs/GUIDE and are included by the existing publication
allowlist. Their old development-directory copies are removed. Relative links
were updated in the API reference, migration guide, lifecycle notes, master plan
and evidence log, including links inside the moved documents. The guide index
identifies these as the authoritative contract pages. No forwarding copies or
runtime compatibility layer was introduced.

Seven guide links to nonexistent README.md files now point to index.md; one
obsolete hooks-guide link points to the existing hook guide. All **184 local
source targets** in README, API, quickstart and guide Markdown exist. This check
does not validate anchors, external URLs or self-contained navigation for every
packaged guide: repository-only evidence links remain and A10-02 stays open.
The pre-change inventory is `/tmp/library-published-doc-links.json` and the
contract move's updated-file list is `/tmp/library-transaction-doc-move.json`.

Node 24 docs build passes (`/tmp/library-transaction-docs-build.log`, 49515).
The actual packed-content/type gate passes with **151 files, 482,900 packed
bytes, 27 runtime exports and 10 negative checks**
(`/tmp/library-transaction-docs-package.log`, 93276); artifact SHA1
`822576a453b5c0a365aae0457c750f27692bd283`. Diff checks pass. No runtime tests
were repeated for these moves/link repairs, and no consumer repository changed.

## 2026-09-11: API reference contract correction

**131/214 complete; 83 open.** The reference retained 54 removed-option
occurrences, malformed resource-access signatures and unsupported examples.
The reviewed correction updates format/returning and inputRecord contracts,
PUT create/replacement and top-level target IDs, minimal response type/ID,
related-resource formats, actual pagination metadata/cursors, resource/schema
declarations, computed callbacks, polymorphic declarations and explicit filter
mapping. Hook examples now use api.customize with injected context; invented
hook registration, error transformation and soft-delete method-switch recipes
are replaced with implemented interfaces or scoped application guidance.
HTTP error examples no longer promise codes the connector does not emit.

Existing verified temporal, storage mapping, managed transaction, schema-helper
and write-outcome corrections are retained. Detailed lifecycle/filtering/visibility
contracts are linked rather than duplicated by fictional broad examples.
The draft and read-only audit were kept in `/tmp/library-api-reference-*` while
the full gate ran; source was changed only after session 43485 completed.

`npm run test:api-reference` extracts the actual schema and two hook examples
from docs/API.md and executes them in both SQLite storage modes. Assertions
cover trimming, computed dependency output, declared filtering, exact
meta.pagination, PUT/PATCH target IDs, minimal/none returns and typed rollback
failure. The applied-source command passes (`/tmp/library-api-reference-final.log`),
as does scoped lint. All local link targets in the reference exist in the source
tree. These are representative execution checks, not proof that every example
or external/fragment link is correct.

The updated tarball/type gate passes with **149 files, 473,679 packed bytes,
27 runtime exports and 10 negative checks** (`/tmp/library-api-reference-package.log`,
10753), SHA1 `569e230ea76431df4ba3ce9cd86563cd810c2a9b`. It has no runtime changes
relative to the full gate below. A10-01/B0-08 remain open for the broader guide,
example and consumer reconciliation. Selected user docs still link to development
contracts excluded from the tarball; source-tree link existence is not proof of
standalone packaged-document navigation. That consolidation remains A10-02 work.

## 2026-09-11: Accumulated diagnostic and package verification

**131/214 complete; 83 open.** Node 24.6.0 `npm run verify` completed with exit 0
(session **43485**, `/tmp/library-diagnostics-package-verify.log`). This gate
covers the accumulated file/registry/Socket.IO diagnostics, include phases,
formatter follow-ups, public declarations, package allowlist and backend guide.

| Gate | Result |
| --- | --- |
| Internal types and packed contents/types | Pass; 149 files, 27 exports, 10 negative checks |
| Query budgets | Both storage modes pass |
| Ordinary full SQLite | 5,734 pass, one existing skip; 317.187 seconds |
| Canonical full SQLite | 5,801 pass, zero skips; 360.159 seconds |
| Express 4 ordinary | 458 pass; 46.872 seconds |
| Express 4 canonical | 460 pass; 50.540 seconds |
| Whole lint and docs | Pass |

**12,453 tests pass; zero failures, one existing skip.** Packed artifact SHA1:
`6cfe0c58347a264b285d97ab72303b389c438603`. Native SQL, real Redis and clean-install
checks remain separately scoped in earlier entries. The API-reference correction
above landed afterward and does not inherit this gate's artifact hash. Consumer
repositories remain unchanged and their migration/verification is paused.

## 2026-09-11: Backend reference and artifact reconciliation

**131/214 complete; 83 open. A10-06 and A10-12 complete.** Added the user-facing
[backend reference](../GUIDE/BACKEND_CAPABILITIES.md), linked from README and the
guide index. It consolidates the existing temporal, schema, transaction, file
and conformance contracts rather than claiming uniform dialect support. It
distinguishes verified SQL/storage combinations, unverified dialects/platforms,
mock S3, known native positioning failure and paused verification. The homepage's
unqualified no-code-change database-switch claim was corrected. README's three
root-relative documentation links now point to their actual docs paths.

All eight local targets in the new reference exist. Node 24 documentation build
passes (`/tmp/library-backend-guide-docs.log`, 20872). After these documentation,
declaration and publication changes, the packed-content/type gate passes with
**149 files, 474,447 packed bytes, 27 runtime exports and 10 negative checks**:
`/tmp/library-backend-guide-package.log`, 31621. Artifact SHA1:
`6cfe0c58347a264b285d97ab72303b389c438603`. Diff checks pass. The previous clean
installation's artifact hash remains separately recorded; it is not relabeled
as this documentation-updated tarball. No runtime or consumer changes, and no
full runtime test rerun for prose edits.

Broader API-reference reconciliation, consumer release coordination and final
artifact checks remain open. Rebuilding the current documentation and checking
its package does not assert that every historical API example is migrated.

## 2026-09-11: Clean package installation

**129/214 complete; 85 open.** Added explicit `npm run test:clean-package`.
It packs and installs into a fresh temporary npm consumer, without symlinked
checkout dependencies, then checks optional-peer-free root/deep imports and
the missing Express dependency diagnostic. Those checks passed in the first
attempt. The subsequent fresh Knex/SQLite install compiled better-sqlite3 from
source and exceeded the verifier's initial 180-second command timeout before
CRUD assertions ran (`/tmp/library-clean-package-timeout.log`). The process
terminated; the temporary consumer was removed. No CRUD success is attributed
to that timed-out attempt.

The command now allows 600 seconds for native installation and prints that
phase explicitly. Replacement session **29265 completed with exit 0**:
`/tmp/library-clean-package.log`. Both ordinary and canonical create/get/patch/
query/delete flows pass against the clean installed artifact. The fresh
dependency tree resolves Knex **3.3.0**, better-sqlite3 **11.10.0**, hooked-api
**1.0.24** and json-rest-schema **1.0.17**, under Node **24.6.0**. The full
resolved dependency list is in the log. Runtime installation excludes optional
peers and the checked development-only packages. Artifact SHA1:
`dcf5bd3bad82c4e66d931e376faced8847bacc16`.

The matching packed-content/type gate also passes with **148 files, 27 runtime
exports and 10 negative type checks** (`/tmp/library-clean-package-types.log`).
Scoped lint, docs and diff checks pass. This smoke check does not establish the
full native-driver matrix on newly resolved dependency versions. It remains
outside the routine full gate. A10-09/A10-10 and real-consumer verification remain
open; no checkout dependency lockfile or consumer repository was changed.

## 2026-09-11: Package content allowlist

**129/214 complete; 85 open. A10-07 complete.** The baseline local package had
444 files, 1,516,928 packed bytes and 6,314,399 unpacked bytes, including agent
instructions, ledgers and parked migration/upstream patches
(`/tmp/library-package-allowlist-before.json`). An exact file-set assertion in
the existing packed public-type gate fails on that source
(`/tmp/library-package-allowlist-regression.log`).

The manifest now explicitly includes runtime JS/declarations, root entries,
license, README and selected API/quickstart/guide Markdown. The check derives
the expected runtime/declaration paths from the source tree and rejects extra
or missing tarball files. All existing runtime paths remain included; no exports
map, forwarding aliases, dependency/version changes or consumer edits were added.

Node 24 `npm run test:public-types` passes with **148 files, 472,199 packed
bytes, 27 runtime exports and 10 line-matched negative type checks**. Artifact
SHA1: `1396f7e5f18c1ad6e408b3b5074c02fa52b488f1`;
`/tmp/library-package-allowlist-after.log`, terminal session 62711. Scoped lint
passes. This is actual tarball extraction/import/type checking with shared
dependencies, not a clean install or consumer migration. A10-08–10 and final
artifact reconciliation remain open; no full runtime suite was repeated for
the package-only change.

## 2026-09-11: Socket.IO notification field policy

**128/214 complete; 86 open.** Four real connection regressions reproduced
structured hidden/normally-hidden values in subscription matching and
pre-delivery permission errors (both WebSocket and polling):
`/tmp/library-socket-field-policy-before.log`. Those two existing catches now
pass the trusted notification resource's compiled schema to the enhanced logger.
The shared scope registry is passed through the existing helper calls; no
resource is inferred from client-supplied URL or authentication data.

Node 24 complete socket contract suites pass **78 ordinary + 78 canonical tests**,
zero failures/skips (`/tmp/library-socket-field-policy-{knex,anyapi}.log`). New
checks assert no notification on denial, retained nonsensitive diagnostic text
and unchanged original hidden values. Coverage includes immediate/deferred
delivery and all existing contract scenarios. Scoped lint was corrected for a
test-only ternary line break. The immediately preceding 92-pass real Redis gate
predates this field-policy change; it was not repeated for this local formatter
option. No full gate, dependency or consumer changes.

Admission/authentication diagnostics, upstream output and other resource-policy
owners remain open under A9-07/A9-08.

## 2026-09-11: Socket.IO diagnostic previews

**128/214 complete; 86 open.** Socket.IO now wraps its existing installation
logger with the shared enhanced logger. This bounds its authentication,
subscription, permission and Redis events without replacing the upstream sink.
The basic socket fixture accepts an explicit logging configuration so real
WebSocket/polling tests can inspect emitted events. Both authentication regressions
reproduced diagnostics above 100,000 characters before the runtime change
(`/tmp/library-socket-diagnostics-before.log`); initially the fixture did not
forward the requested logging configuration and that setup was corrected.

The applied regressions pass, preserving original authentication-error identity
at the failure hook, the client rejection message and original binary/text
payloads. Full affected socket/authorization selections pass **178 + 178 tests**
in ordinary/canonical modes (`/tmp/library-socket-diagnostics-{knex,anyapi}.log`).
Real Redis lifecycle/notification checks pass **46 + 46 tests**
(`/tmp/library-socket-diagnostics-redis.log`, terminal 79797), including failed
startup, reconnecting shutdown and cross-server notifications. Zero failures or
skips. The first Redis invocation stopped before tests because redis-server was
absent from PATH; the successful run used the existing disposable binary under
`/tmp/jra-redis-binaries-UPZeIA/root` and its library directory. Scoped lint passes.

This establishes bounded plugin output, not resource-specific redaction or
upstream parameter sanitization. A9-07/A9-08 remain open. No full-library gate
rerun, dependency edits or consumer changes.

## 2026-09-11: Registry rollback diagnostic previews

**128/214 complete; 86 open.** Registry rollback failures previously logged the
entire mutable completion context. Three regressions (new registration,
replacement registration and field allocation) each reproduced output above
200,000 characters (`/tmp/library-registry-diagnostics-before.log`). The existing
enhanced logger now bounds explicit method/resource, registryRollback phase,
backend, outcome, tenant and error/cleanup fields. Binary data receives a size
preview. No transaction objects or additional context fields are passed.

Node 24 registry/descriptor suites pass **138 tests**
(`/tmp/library-registry-diagnostics-after.log`). The native registry matrix passes
**408 tests**: 67 each SQLite/MySQL invocation and 70 each PostgreSQL invocation,
across both runner storage environments
(`/tmp/library-registry-diagnostics-matrix.log`, terminal session 37090). These
fixtures explicitly use canonical storage in every environment. All runs have
zero failures/skips; scoped lint and diff checks pass. Assertions retain original
write causes, unchanged error payloads and database/cache outcomes, including
rollback and logger failure cases. Emitted diagnostics are snapshots; subsequent
logger failure remains on the original cleanup context. No full suite rerun.

This closes another direct output boundary, not A9-07/A9-08: arbitrary external
error text, upstream logging and other field-policy owners remain open. Consumer
repositories remain untouched.

## 2026-09-11: Include wrapper phase context

**128/214 complete; 86 open.** Existing include error wrappers now identify
`include` or `relationshipMetadata` alongside their resource/relationship
context. They continue to reuse `wrapUnexpectedError`: typed REST errors retain
identity, and generic, frozen and primitive failures retain their original cause.
The six-relationship failure matrix checks phase context through the wrapper
chain, including throwing/rejecting secondary loggers.

Final Node 24 checks pass **92 error-boundary tests + 141 ordinary and 141
canonical-environment include/metadata checks**, zero failures/skips:
`/tmp/library-include-phase-final.log` and
`/tmp/library-include-phase-{knex,anyapi}.log`. Scoped lint passes. The initial
outer-wrapper regression failed before its phase was added; a subsequent test
incorrectly expected the standalone identifier loader to use the metadata
wrapper. That assertion was corrected after inspecting the distinct boundaries.
Nested/adapter legacy fixtures remain SQLite checks, not native-driver evidence.
No full gate rerun or consumer changes. A9-07/A9-08 remain open for other owners
and failing phases, including the standalone identifier loader.

## 2026-09-11: Custom error JSON stack policy

**128/214 complete; 86 open.** Custom toJSON output could reintroduce a stack
omitted by includeStack:false or protected message fields. Two root-output
regressions fail before the fix (`/tmp/library-custom-stack-before.log`); the
nested object/array variants also fail before propagation is added
(`/tmp/library-custom-nested-stack-before.log`). The existing bounded serializer
now carries stack omission through the custom error JSON tree and skips those
keys before property reads. Other custom metadata remains visible.

Final Node 24 formatter/logger/error-boundary suites pass **89 tests**, zero
failures/skips (`/tmp/library-custom-stack-final.log`). Counter assertions prove
zero root/nested stack-getter reads for both policies. Final scoped lint passes
(15987). No runtime API/transaction change, full/native gate rerun or consumer
edits. This is another verified formatter boundary; A9-07/A9-08 retain their
broader open acceptance work.

## 2026-09-11: Shared operation diagnostic context

**128/214 complete; 86 open.** Added one checked helper in the existing
error-context module for method/resource, reporting phase, Knex backend and
transaction-outcome snapshots. Write failures, Express/Fastify errors and file
cleanup warnings use it. Only the client identifier is copied, not connection
configuration. Route resources come from trusted metadata; unavailable fields
remain null. Existing error causes and cleanup diagnostic objects are retained.

Three baseline checks fail before the change because phase metadata is absent
(`/tmp/library-operation-diagnostics-before.log`). Final focused SQLite checks
pass **34 ordinary + 34 canonical tests** (3423/9006,
`/tmp/library-operation-diagnostics-final-{knex,anyapi}.log`). The native matrix
passes **60 tests**, ten per SQLite/PostgreSQL/MySQL and storage-mode combination
(87286, terminal zero; `/tmp/library-operation-diagnostics-matrix.log`). Express
4 adds **2 ordinary + 2 canonical passes** (8240/5019,
`/tmp/library-operation-diagnostics-express4-{knex,anyapi}.log`). All have zero
failures/skips. Typecheck (7650) and scoped lint (29453) pass.

Assertions verify no-transaction GET errors, rolled-back write/HTTP errors and
pending file-cleanup snapshots before later success/failure. Reporting phases
are explicit boundary names, not invented failing-hook names. Broader precise
failure-phase coverage and direct/upstream owners still keep A9-07/A9-08 open.
No full suite repeat or consumer changes.

## 2026-09-11: File-cleanup warning diagnostics

**128/214 complete; 86 open.** Routed the existing file-cleanup warning through
the shared enhanced logger with the current compiled schema's field policy.
The cleanup diagnostic still retains the original error object; warning-writer
failures still become secondary logging diagnostics. No transaction, storage or
cleanup-order behavior was changed.

Four regressions fail before the fix because the warning exceeds its size bound
(`/tmp/library-file-cleanup-diagnostics-before.log`). They now verify bounded
warnings, hidden-field redaction, binary size metadata, retained error identity,
stored-row outcomes and uploaded-file deletion for successful/failed writes in
both response formats. The complete affected suite passes **105 ordinary + 105
canonical tests**, zero failures/skips (81878/55009,
`/tmp/library-file-cleanup-diagnostics-{knex,anyapi}.log`). Final scoped lint passes
(42772); only fixture whitespace was corrected after those test runs.

This focused change follows the preceding 12,411-pass full milestone, which is
not claimed to include it. No repeated full/native gate or consumer changes.
A9-07/A9-08 remain open for remaining output owners, phase/backend/outcome
metadata and broader resource-policy coverage.

## 2026-09-11: Accumulated typing and diagnostics verification

**128/214 complete; 86 open.** The accumulated Node 24 `npm run verify` gate
completed successfully (74273, terminal zero;
`/tmp/library-types-diagnostics-verify.log`). Runtime and test sources were held
unchanged throughout the run. No failed stage or restart was needed.

| Stage | Result |
| --- | --- |
| Internal typecheck | Pass |
| Packed public declaration consumer | Pass; 27 runtime exports, 10 line-matched negative checks; artifact SHA-1 `6e14886a0e7ea224b3bf0f1d20d3c9a368b65057` |
| Query budgets, ordinary and canonical | Both pass |
| Full ordinary SQLite suite | 5,719 pass, zero failures, one existing skip; 334.068 seconds |
| Full canonical SQLite suite | 5,786 pass, zero failures/skips; 393.681 seconds |
| Express 4 ordinary selection | 452 pass, zero failures/skips; 33.591 seconds |
| Express 4 canonical selection | 454 pass, zero failures/skips; 36.528 seconds |
| Repository lint and documentation build | Both pass |

Combined test invocations: **12,411 passes, zero failures, one existing skip**.
This is the scheduled full milestone for the accumulated public declaration,
HTTP and diagnostic changes. It does not replace native-database/Redis or actual
consumer acceptance. Consumer repositories remain paused. A read-only review
during the gate confirmed that file-cleanup warnings still send backend errors
directly to the base logger; that remaining A9 output boundary is next. Only
evidence prose is updated after this gate; no runtime change is included in the
claim without having passed it.

## 2026-09-11: Binary diagnostic metadata

**128/214 complete; 86 open.** Diagnostic traversal previously enumerated Buffer
and typed-array contents and arbitrary attached properties. Six binary-preview
regressions fail before the change (`/tmp/library-binary-diagnostics-before.log`).
The shared formatter now emits type and byte length for buffers/views, including
binary values thrown directly. The existing error-context module owns the small
shared binary preview so safe message wrapping and formatter catch diagnostics
also avoid stringifying thrown bytes; original causes remain intact.

Final Node 24 focused suites pass **87 tests**, zero failures/skips
(`/tmp/library-binary-diagnostics-final.log`). Checks cover Buffer, typed arrays,
DataView subranges, ArrayBuffer/SharedArrayBuffer, upload metadata, nested errors,
unread attached properties and thrown binary values. Typecheck passes (15010,
`/tmp/library-binary-diagnostics-types.log`); final lint passes (59815). No new
dependency or consumer changes. Wider field/output-owner redaction remains open.
An accumulated full verification milestone follows this focused acceptance;
its results must be recorded separately after terminal completion.

## 2026-09-11: Diagnostic metadata access and stack redaction

**128/214 complete; 86 open.** Continued the formatter review through top-level
name/message/stack/code/details getters, summaries, validation convenience
logging and error-envelope classification. Seven new cases all failed before
the fixes (`/tmp/library-diagnostic-metadata-before.log`). An enumerable stack
also bypassed message redaction; its regression failed separately
(`/tmp/library-diagnostic-stack-before.log`).

Shared guarded property reads now preserve diagnostic output after accessor
throws. Redaction precedes protected message/details reads, and stack output is
suppressed when the error name/message is protected. Full and nested error
metadata use the same implementation. Validation classification avoids invoking
custom JSON conversion an extra time; its regression asserts one conversion.

Final Node 24 focused suites pass **80 tests**, zero failures/skips
(`/tmp/library-diagnostic-metadata-final.log`). Existing write and real HTTP
diagnostic suites pass **6 ordinary + 6 canonical checks** (22276/29149,
`/tmp/library-diagnostic-metadata-integration-{knex,anyapi}.log`), and targeted
lint passes (48010). The changes affect unchecked formatter/logger bodies;
checked transaction types and runtime transaction logic are unchanged. No full
or native gate repeated, and no consumer changes. A9-07/A9-08 remain open for
the wider diagnostic/redaction inventory and pending upstream output owners.

## 2026-09-11: Diagnostic serializer failure containment

**128/214 complete; 86 open.** The continuing A9 review found secondary failures
inside diagnostic formatting: catch blocks assumed every thrown value had a
message, important non-enumerable properties were read outside their guard,
and the toJSON accessor was read before entering its guard. These paths could
replace useful diagnostic output with another exception.

Reused and exported the existing internal `errorMessage` helper; formatter
fallbacks now safely describe non-Error throws. Important property reads and
toJSON lookup/call stay inside their guards, with the original method receiver
preserved. No new formatter abstraction or dependency was introduced.

The initial four-case selection had three failures and one passing string-throw
control (`/tmp/library-diagnostic-serialization-before.log`); the added toJSON
accessor case also fails before its fix
(`/tmp/library-diagnostic-accessor-before.log`). Final Node 24 focused suites
pass **72 tests**, zero failures/skips
(`/tmp/library-diagnostic-serialization-final.log`). Typecheck passes (55707,
`/tmp/library-diagnostic-serialization-types.log`) and final targeted lint passes
(50837). Tests cover null/undefined/string serializer throws, nested/enumerable
getters, non-enumerable causes and a throwing toJSON accessor, preserving the
original message and remaining fields. Top-level metadata/summary accessor
handling and the wider redaction/diagnostic inventory remain to review; A9-07/08
are not complete. No full/native test rerun or consumer changes.

## 2026-09-11: Post-commit and cleanup policy acceptance B4-05

**128/214 complete; 86 open. B4-05 is complete.** Reviewed the shared completion,
rollback and file-cleanup boundaries against the selected strict read policy.
No new runtime change was needed: committed outcomes are established before
completion hooks, finished/completed transactions do not issue another rollback,
and secondary cleanup errors retain their own diagnostics. Unexpected read
failures still propagate; this does not make cleanup warnings read failures or
permit undoing an acknowledged commit.

The focused Node 24 native matrix passes **150 checks**, 25 each on SQLite,
PostgreSQL 16.15 and MySQL 8.0.46 in ordinary/canonical modes (40639, terminal
zero; `/tmp/library-b4-completion-boundaries-matrix.log`). The selected tests
assert stored rows/files, rollback attempt counts, original causes, outcomes,
completion order and secondary diagnostic indexes:

- Post-commit hook rejection reports committed, retains the row and attempts no rollback.
- Failed afterRollback hooks preserve the original failure for all eight direct/relationship operation forms, with owned and managed transactions.
- Later managed file completion chains run after an earlier commit/rollback hook rejects, with committed files retained and rolled-back files removed.
- Failed upload cleanup preserves its diagnostic while other files are still deleted; rejection after driver completion preserves committed uploads.

Another **16 focused SQLite checks** (8 per storage mode) verify temporary-file
cleanup and logging failures with successful/failed writes in both response
formats (59409/78741, terminal zero;
`/tmp/library-b4-temporary-cleanup-{knex,anyapi}.log`). All selections have zero
failures/skips. Existing tests already covered these requirements; this audit
connects that implementation to the still-open checklist item. No full suite,
runtime edits or consumer changes. B4-02/B4-07 remain open for paused consumer
migration/acceptance.

## 2026-09-11: Concurrency public contract acceptance B3-11

**127/214 complete; 87 open. B3-11 is complete.** The acceptance review matched
each requirement to public package imports, runnable examples, documentation
and focused runtime checks. This closes concurrency-specific acceptance, not
automatic API inference, the whole A9 typing effort or paused app migrations.

| Requirement | Evidence |
| --- | --- |
| Public types | Added `ResourceVersionOptions`; packed imports cover direct conditions, all relationship mutation forms, bulk conditions, validator/CORS options and exported conflict/write errors. Strict NodeNext compilation passes against the actual tarball. |
| Rejected invalid contracts | Ten packed negative fixtures reject removed options, invalid returning/field assumptions, malformed version configuration/arguments, conditional creation, scalar bulk conditions and wrong HTTP/CORS option shapes. Each diagnostic must match its intended source line. |
| Runnable consumer examples | `examples/conditional-http-client.js` is imported and exercised against real Express/Fastify servers. The existing backfill helper and migration guide cover stored revisions, with earlier native acceptance retained under B3-03. |
| CORS guidance | The migration guide shows explicit allow/expose header arrays, notes replacement of defaults and preserves credentials. The client tests verify preflight and readable ETags/stale failures. |
| Unconditional operations | Focused direct version tests cover unconditional PUT in both response formats; connector tests cover unconditional POST/PATCH/DELETE with validators enabled. |

Node 24 packed check passes (12631,
`/tmp/library-public-concurrency-types.log`): **27 runtime exports, 10 negative
checks**, artifact SHA-1 `c4d8f5f06c65fc6540ff6b4531258ae9406ae4bf`. Focused runtime
selection passes **10 ordinary + 10 canonical checks**, zero failures/skips
(20603/34230, `/tmp/library-concurrency-public-acceptance-{knex,anyapi}.log`).
New script lint passes (92259). No runtime logic changed, no full/native gate
was repeated and no consumer repository was touched.

## 2026-09-11: Packed public declaration integration

**126/214 complete; 88 open.** Added the root declaration entry point and manifest
`types` field. All 27 runtime exports agree with their declaration exports;
completed option/resource/transaction components are available as root type
imports. Added `npm run test:public-types` to `npm run verify`. The gate extracts
an npm tarball into a temporary consumer and uses strict NodeNext without
allowJs/skipLibCheck. Only dependency files are shared with this checkout.

The initial packed check caught an internal declaration depending on JSDoc
exports from a JavaScript file unavailable to strict external consumers. Moved
the shared owned-transaction type into the existing declaration module and
updated checked imports; transaction outcomes reuse the public error type.
Also kept the private managed-transaction marker out of root exports and fixed
an incorrect constructor call in the consumer fixture.

Final Node 24 packed check passes (39429,
`/tmp/library-packed-public-types.log`): 27 exports and three intended negative
checks, artifact SHA-1 `66af06bf41724a6e523412115112243c53f4c25a`. Internal typecheck
passes (46152, `/tmp/library-root-declarations-types.log`) and the new script's
lint passes (36940). Subsequent changes wire the same gate into verify and
document its scope. No runtime logic or dependencies changed. Automatic
hooked-api installation/resource inference, remaining public options/deep import
coverage, clean dependency installation and actual app acceptance remain open;
no complete A9-09/B3-11 claim or full/native suite rerun. Consumer work stays paused.

## 2026-09-11: Autofilter declaration foundation

**126/214 complete; 88 open.** Added resolver, field filter, preset/resource
configuration and inspection declarations after reviewing compilation and
resolver dispatch. Existing storage field types are reused; unknown resolver
values and framework services are not widened to any. Both current resolver
keys and their nullish fallback are represented without runtime changes.

Node 24 typecheck passes (10264,
`/tmp/library-public-autofilter-types.log`). The compiler-host audit reports
exactly six intended diagnostics in the fixture (98640, terminal zero).
Positive fixtures cover async/absent/null values, registered/inline resolvers,
array/object presets, additive resource filters and nullable inspection results.
No full/native suite rerun or consumer/dependency changes. The accumulated type
components still need package entry-point integration and public import checks;
the unchanged checklist count reflects that incomplete acceptance condition.

## 2026-09-11: Row-policy declarations and nullable alias correction

**126/214 complete; 88 open.** Added row-policy callback/configuration/inspection
declarations using the existing checked storage types. The review also corrected
the shared column helper's annotation to accept the documented null alias;
runtime behavior is unchanged. Policies require explicit boolean decisions.
Custom serializer results remain unknown and must be narrowed before use in
typed Knex bindings; the first positive fixture exposed that requirement and
was corrected without widening the storage contract.

Node 24 final typecheck passes (16682,
`/tmp/library-public-row-policy-types.log`). The compiler-host audit produces
exactly five intended diagnostics for missing/query-builder decisions, invalid
registry/resource options and invalid aliases (98892, terminal zero). Positive
fixtures cover application context, async denial, registry inspection and null
aliases through both public policy and checked helper signatures. Public
resource/plugin integration remains open; no full/native suite rerun for these
type-only changes, and no consumer/dependency changes.

## 2026-09-11: Fastify option declaration foundation

**126/214 complete; 88 open.** Declared the existing Fastify server requirement
and connector options after reviewing route, parser, encapsulated registration
and fallback-hook use. The host declaration checks callable capabilities and
preserves explicitly supplied instance types without importing the optional
framework into the declaration graph. It does not replace Fastify's own API.

Node 24 typecheck passes (80344,
`/tmp/library-public-fastify-options-types.log`). Positive fixtures use real
Fastify HTTP/1 and HTTP/2 types; five negative fixtures reject missing or invalid
hosts and options. The compiler-host audit reports exactly those five intended
diagnostics, and the standalone declaration graph checks successfully without
importing Fastify (17546, terminal zero). Root/plugin and consumer acceptance
remain open. No runtime/dependency/consumer changes or full/native test rerun.

## 2026-09-11: File detector declaration foundation

**126/214 complete; 88 open.** Added detector registry, parsed upload and Express
parser option/factory declarations. Checked the declarations against detector
dispatch, MIME/size validation and Express's request-only wrapper calls. Peer
parser options remain open records; no runtime or dependency changes were made.

Node 24 normal typecheck passes. A compiler-host audit disabling only the six
expected-error directives produces exactly the six intended diagnostics, all in
`tests/types/public-file-detectors.ts` (84156, terminal zero). The audit checks
boolean detection, required MIME/numeric size, single-file result shape,
supported parser names and complete factories. Public root/plugin integration
and consumer acceptance remain open. No full or native suite rerun was needed
for these declaration-only changes.

## 2026-09-11: File storage declaration foundation

**126/214 complete; 88 open.** Added declarations for LocalStorage, the mock
S3Storage and their adapter/file inputs. Reviewed every exported class method,
local content/path handling and custom naming. Local upload requires a content
source; custom naming requires a string-producing generator. S3's required
bucket and unsupported real mode are reflected in its constructor options.
The adapter interface also accepts synchronous results, matching awaited calls
in the file plugin. No production S3 support is implied or implemented.

Initial Node 24 typecheck passes (43273); the compiler-host audit produces the
six intended diagnostics (73576, terminal zero). Final positive refinements
cover synchronous adapters and iterable contents; their typechecks pass
(38325/86004, `/tmp/library-public-file-storage-final-types.log` and
`/tmp/library-public-file-storage-contents-types.log`). Node's general writeFile
input type is used because the installed FileHandle signature omits iterable
inputs despite documenting their support. No runtime/consumer/dependency changes
and no database/full test rerun. Root/plugin integration remains open.

## 2026-09-11: Storage and auxiliary plugin option declarations

**126/214 complete; 88 open.** Reviewed ordinary/canonical storage installation
and added required Knex-instance options plus optional canonical tenant ID.
Also declared the existing bulk limit/atomic defaults and label preferences.
No configuration or dependency was introduced.

Node 24 typecheck passes (89955,
`/tmp/library-public-storage-options-types.log`). Six negative fixtures reject
missing/configuration-only database arguments and invalid tenant, bulk and
label option shapes. The compiler-host audit produces exactly those six
diagnostics (62971). No runtime or consumer changes; no database/full test
gate was repeated. Plugin installation and root-package integration remain open.

## 2026-09-11: Managed transaction declaration foundation

**126/214 complete; 88 open.** Reviewed `transactionMethod` and the managed
transaction specification. Corrected preceding write declarations that accepted
raw Knex handles: only reads accept those; writes now require the type-only
managed handle supplied to `TransactionMethods.transaction`. Runtime ownership
remains private and no wrapper/marker property is added. SQL calls and callback
return values remain typed; manual completion and savepoints are unavailable
through the managed public type.

Node 24 typecheck passes (20767,
`/tmp/library-public-transactions-types.log`). Positive fixtures compose resource,
relationship and bulk writes with SQL, and use raw handles for reads. The
compiler-host audit produces exactly eight intended negative diagnostics
(17090, terminal zero), covering unmanaged writes, forbidden completion and
transaction call shape. No runtime or consumer change; no database/full test
gate repeated. Plugin declarations and root/consumer integration remain open.

## 2026-09-11: Plugin option and direct-ID declaration foundation

**126/214 complete; 88 open.** Added core defaults/normalizer, shared connector
flags and CORS option declarations without optional framework imports. Reviewed
the actual plugin option reads and CORS predicate handling. Framework-specific
host, parser/middleware and plugin installation contracts remain unfinished.

The normalizer review found direct BigInt ID support missing from the preceding
method drafts. Direct parameters now use a separate ID type; write documents and
relationship linkage still accept only string/number IDs, matching validation.
Bulk deletion metadata preserves input IDs, while resource output IDs normalize
to strings. Positive fixtures cover direct GET/PATCH, linkage reads and bulk
deletion with BigInt; a negative fixture rejects it in a linkage payload.

Node 24 typecheck passes (98643,
`/tmp/library-public-plugin-options-types.log`). The compiler-host audit reports
exactly seven intended negative diagnostics (89258, terminal zero). No runtime,
dependency or consumer changes; no database/full test gate was repeated.
A9-09/B3-11 remain open for the complete declaration surface and integration.

## 2026-09-11: Relationship declaration foundation

**126/214 complete; 88 open.** Added relationship linkage/read/write declarations
with type-only maps for target fields, names and cardinality. The draft models
nullable to-one related reads, collection envelopes and format-independent
JSON:API linkage documents. Mutation methods return void, accept parent revision
conditions and restrict append/delete to to-many relationships.

The first typed-map check passed (55468), but the added dynamic-map example
exposed an inference-guard placement error (58631). Moving NoInfer around the
resolved query/input types preserved distribution and allowed dynamic collection
queries and array linkage. Final Node 24 typecheck passes (33504,
`/tmp/library-public-relationship-final-types.log`). The final compiler-host audit
produces exactly eight intended negative diagnostics (91187, terminal zero),
with no fixture source changes. No runtime, consumer or dependency changes;
no database/full suite rerun. Plugin declarations, root installation and consumer
acceptance keep A9-09/B3-11 open.

## 2026-09-11: Bulk declaration foundation

**126/214 complete; 88 open.** Added bulk POST/PATCH/DELETE declarations with
batch metadata, indexed errors, resource-level JSON:API results and no-return
metadata. Creation rejects revision conditions; update/delete accept aligned
string arrays. Transaction options distinguish explicit/configured atomic mode
from non-atomic mode, which cannot borrow a transaction. Query selection options
are omitted because the bulk implementation does not forward them to children.
Array lengths, token content and resource configuration remain runtime checks.

Initial Node 24 typecheck passes (29425,
`/tmp/library-public-bulk-types.log`). The compiler-host audit verifies normal
checking and exactly eight intended negative diagnostics (84149, terminal zero).
The final declaration excludes unforwarded queryParams. This remains a draft
component of the eventual root declaration, not a new runtime import path.
Relationship and plugin declarations, package integration and consumer
acceptance remain open. No runtime or consumer code changed.

## 2026-09-11: Connector command coverage correction — verified

**126/214 complete; 88 open.** The explicit connector commands omitted the new
HTTP validator/client suites. Ordinary/canonical commands now include those,
their shared helper/response tests, bulk revision coverage and route transaction
coverage. Express 4 adds the validator/client files and matching suite names to
its filter. This also retains those Express 4 checks in `npm run verify`.
Only scripts and test-scope documentation changed; dependencies did not change.

Node 24 `npm run test:connectors` passed (session **82235**, terminal zero;
`/tmp/library-connector-command-coverage.log`). Ordinary storage passed 1,509,
canonical storage 1,530, Express 4 ordinary 452 and Express 4 canonical 454:
**3,945 passed, zero failures/skips**. This is the connector selection, not a
new full library or native database run.

## 2026-09-11: Resource CRUD declaration foundation

**126/214 complete; 88 open.** Added the six core resource method declarations,
separating writable/returned fields and configured defaults. Inspected the
runtime request contracts, write setup and response selection before specifying
target IDs, query/selection options, revision arguments and return modes.
NoInfer prevents an input body from widening the format inferred from options.
Application context accepts ordinary interfaces without index signatures.

Node 24 typecheck passes (`/tmp/library-public-resource-methods-types.log`,
15946). After the context refinement, a compiler-host audit confirms the normal
program has no diagnostics, then produces exactly ten intended negative
diagnostics when only this fixture's expectation comments are disabled in
memory (44524, terminal zero). No runtime or consumer changes, and no database
or full-suite rerun. Relationship/bulk declarations, plugins, package resolution
and consumer acceptance still keep A9-09/B3-11 open.

## 2026-09-11: Public representation declaration foundation

**126/214 complete; 88 open.** Added declaration building blocks for plain and
JSON:API results, normalized/input identifiers, collection envelopes and
`none`/`minimal`/`full` write results. Shapes were checked against response-options,
the shared post-write response helper and simplified response conversion.
Sparse fieldsets do not statically promise every declared field is present.

Node 24 typecheck passes (`/tmp/library-public-representations-types.log`, 69802).
Seven negative fixtures cover output ID normalization, collection envelopes,
minimal/no-return shapes, optional selected fields, resource types and removed
format aliases. The compiler-host audit produces exactly their seven intended
diagnostics (68100), with no edits to fixture source. No runtime change or
database/full test rerun. Resource method inputs and defaults, plugin contracts,
root declaration installation and consumer acceptance remain open under A9-09
and B3-11; no consumer repository changed.

## 2026-09-11: Public error declaration foundation

**126/214 complete; 88 open.** Added a self-contained declaration draft for the
existing nine error classes and three constants in `types/errors.d.ts`.
Constructor/output shapes were checked against `lib/rest-api-errors.js`.
Write errors preserve unknown causes and forwarded fields; their required finite
transaction outcome is read-only. Concurrency errors retain resource-error
inheritance and distinct codes. This is declaration preparation, not a new
runtime module or a claim that the root package already has public types.

Node 24 `npm run typecheck` passes (32052,
`/tmp/library-public-errors-types.log`). A compiler-host audit removed the seven
expectation comments only in memory; all seven sites produced their intended
diagnostics with no others (31113, terminal zero). Runtime source is unchanged,
so no database/full test gate was repeated. A9-09 and B3-11 stay open for the
remaining surface, package resolution and consumer acceptance. Consumers remain
paused and untouched.

## 2026-09-11: HTTP validator acceptance B3-06

**126/214 complete; 88 open. B3-06 is complete.** The final protocol review
removed a special PUT callback that replaced an already-detected hidden-target
404 with 412. Normal errors now precede comparison, following
[RFC 9110 section 13.2.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.2.1).
Otherwise-admissible missing-target PUT creation still fails If-Match with 412.
The migration guide explicitly describes these distinct HTTP PUT outcomes;
the direct expectedVersion API's hidden/missing behavior is unchanged.

Four regressions failed before the fix (`/tmp/library-http-put-precedence-before.log`,
62465). Hidden strong/wildcard responses now match the unconditional error body.
The normal-error, missing-target, matching-write and deletion-race selection
passes **240 native checks**, 40 per database/storage combination
(`/tmp/library-http-put-precedence-matrix.log`, 34575, terminal zero), plus
**40 Express 4 checks**, 20 per mode
(`/tmp/library-http-put-precedence-express4-{knex,anyapi}.log`, 77170/14994,
terminal zero). Zero failures/skips. Typecheck and scoped lint pass
(26029/53575). This was a two-line runtime removal; no full suite was repeated.

The B3-06 review also verified the accumulated implementation and evidence:

| Acceptance area | Evidence and boundary |
| --- | --- |
| Strong comparison and exact bytes | `http-validators.test.js`, `http-response-replacement.test.js` and real framework-serialization checks; connector serializes once and hashes that body, including hook replacement. |
| Includes and computed variants | Native `conformance-http-validators.test.js` cases observe changed included records, nested computed reads using the write transaction, provisional dependency rollback and row visibility. Fieldset/query and request-header variants select the speculative GET. |
| Atomic comparison and mutation | Serializable managed write transaction plus parent lock; native same-tag requests allow only one commit. `conformance-serializable-transactions.test.js` verifies conflicting dependency snapshots. Native transaction conflicts remain errors, without automatic retry. |
| Hook/context ownership | Speculative GET metadata and copied normalized headers; failed rendering rolls back writes and cannot leak response headers. Computed reads borrow the transaction. Native request objects and external application effects remain application-owned, as documented. |
| Methods and error ordering | GET/HEAD, resource PUT/PATCH/DELETE, malformed/weak/list/wildcard handling, ignored non-representation methods, unsupported routes and normal validation/permission failures. PUT emits no transformed-response validator. |
| Default and integration behavior | Validators default off. Unconditional calls remain available. Express 5, Express 4 and Fastify checks cover both storage modes; the accumulated full milestone passed 12,209 tests before subsequent focused additions. |

This closes behavioral HTTP acceptance, not B3-11's public declarations or the
paused consumer migration. Framework JSON serializers are bypassed for opted-in
GET/HEAD; later middleware transformations must maintain their validator.
Custom resource handlers must await the supplied precondition and use its
transaction; arbitrary custom handlers or external effects are not made atomic.

## 2026-09-11: Versioned operation acceptance B3-10

**125/214 complete; 89 open. B3-10 is complete.** Six new races cover
POST/PATCH/DELETE relationship methods for has-many and many-to-many membership.
Two real transactions synchronize at permission checking and submit the same
parent revision. Exactly one succeeds; the other reports a version conflict
or SQLite busy failure. Final linkage contains only the winning change, the
parent token rotates, and both child records remain intact.

The complete relationship suite passes **72 native checks**, 12 per
database/storage combination (`/tmp/library-versioned-relationship-races-matrix.log`,
36917, terminal zero), with zero failures/skips on Node 24. The initial ordinary
SQLite run also passed 12 checks. ESLint identified a Promise callback naming
violation; only local callback identifiers were renamed after the native run.
No runtime source changed and no full suite was repeated.

The acceptance review checked test bodies and recorded native outputs for the
whole item, rather than treating the new race selection as complete coverage:

| Required behavior | Evidence |
| --- | --- |
| Direct versions, PUT-create, DELETE and both formats | `conformance-versioned-writes.test.js`: initialization, unconditional replacement, conditional deletion/creation rejection, stale and concurrent PATCH; native execution in `/tmp/library-http-precedence-matrix.log`. |
| Caller transactions and rollback | Successive revisions and stale reuse inside one borrowed transaction in that suite; bulk caller rollback in `conformance-versioned-bulk.test.js`; relationship/membership rollback and notification suppression in `conformance-versioned-notifications.test.js`. |
| Supported relationship changes and races | `conformance-versioned-relationships.test.js`, all six method/relationship combinations in the 72-check native run above. Inverse membership and deletion rollback remain covered by `conformance-inverse-versions.test.js`. |
| Atomic and non-atomic bulk behavior | `conformance-versioned-bulk.test.js`: indexed partial failures, full rollback, repeated IDs, malformed arrays and unversioned targets. Existing `/tmp/library-versioned-bulk-final-matrix.log` records 852 passing checks with the broader bulk suites. |
| Both HTTP connectors and unsupported combinations | The preceding visibility/bulk checkpoint verifies body-level revision conditions with HTTP validators enabled, rejection of unsupported bulk headers before non-atomic work, and Express 4 parity. Resource conditional PUT/PATCH/DELETE and rollback are covered by `conformance-http-validators.test.js`. |
| Failure side effects | The existing 144-check `/tmp/library-version-transaction-effects-matrix.log` verifies file and notification cleanup, including caller and atomic bulk rollback. |

The accumulated full milestone also passed all then-existing tests (12,209
passes, one existing skip). New selections above extend that evidence without
claiming a new full run. B3-06 retains HTTP protocol/rendering acceptance;
B3-11 retains public declarations. Consumer repositories remain paused.

## 2026-09-11: Strong visibility and bulk HTTP condition boundaries

**124/214 complete; 90 open.** Strong PUT/PATCH/DELETE tests now submit a tag
obtained before the target becomes read-hidden, verify no mutation, then delete
the same target and compare the full error document. Existing permission tests
verify forbidden writes precede stale-tag comparison. The selection passes
**72 native checks**, 12 per database/storage combination
(`/tmp/library-http-strong-visibility-matrix.log`, 40627, terminal zero).

The HTTP bulk fixture now enables validators while retaining its body-level
revision tests. New non-atomic POST/PATCH/DELETE cases submit wildcard and strong
If-Match values; all reject with the explicit unsupported-route 422, preserving
both records and their revision tokens. Existing body-level conditions still
accept current revisions and roll back stale batches. This selection passes
**72 native checks** (`/tmp/library-http-bulk-validators-matrix.log`, 26910,
terminal zero). Express 4 passes **24 combined checks**, 12 per mode
(`/tmp/library-http-visibility-bulk-express4-{knex,anyapi}.log`, 6156/31621,
terminal zero). All 168 native/Express 4 checks have zero failures/skips.
Scoped ESLint passes (37204). No runtime changes or full-suite rerun.

The review also re-read RFC 9110 section 13.2.1's normal-check precedence.
The existing special handling for hidden conditional PUT is tested here but
is not declared protocol acceptance merely because those tests pass. B3-06
remains open for that decision; B3-10 still requires its aggregate acceptance
review, including broader relationship race evidence. Consumer work stays paused.

## 2026-09-11: Framework serialization ownership verified

**124/214 complete; 90 open.** The real HTTP client fixture now installs Express
JSON spacing, escaping and a replacer, or a Fastify custom reply serializer.
Selected GET bytes retain the original angle-bracket/ampersand value, use compact
JSON and match their strong ETag exactly. Successful PATCH responses prove the
framework transformations are active, while conditional comparison still accepts
the selected GET tag. This directly verifies the migration guide's serialization
contract rather than assuming the framework settings were inactive.

Node 24 passes **18 checks**: six each in ordinary/canonical Express 5/Fastify,
three each in ordinary/canonical Express 4. Logs are
`/tmp/library-http-framework-serialization-knex-final.log`,
`/tmp/library-http-framework-serialization-anyapi.log` and
`/tmp/library-http-framework-serialization-express4-{knex,anyapi}.log`;
sessions 31647/23991/46837/69120 all exited zero. No failures/skips. Scoped
ESLint passes (52672). Runtime source did not change; no full/native gate was
repeated. B3-06's remaining protocol review and B3-11's public types stay open.

## 2026-09-11: Runnable HTTP client and CORS checkpoint

**124/214 complete; 90 open.** `examples/conditional-http-client.js` separates
reading/editing from saving, preserves the selected URL, headers and quoted
ETag, and returns failed responses without silently retrying. Its tests run
against real loopback HTTP servers and verify successful save, stale-write
rejection with unchanged persisted data, preflight allowance and ETag exposure.
The 412 response retains the configured origin/credentials headers. These are
HTTP contract tests; they do not claim browser-enforced CORS execution.

Node 24 passes four checks per storage mode in Express 5/Fastify
(`/tmp/library-http-client-example-{knex,anyapi}.log`, anyapi session 14269),
plus two per mode in Express 4
(`/tmp/library-http-client-example-express4-{knex,anyapi}.log`, 3205/87121).
All **12 checks pass, zero failures/skips**, all processes terminal zero.
Scoped ESLint passes (97205). No runtime code changed and no full suite or native
database matrix was repeated. Public declarations and remaining acceptance
still keep B3-11 open; consumer repositories remain untouched.

## 2026-09-11: Accumulated HTTP milestone full verification

**124/214 complete; 90 open.** The Node 24.6.0 `npm run verify` run completed
successfully (session 95172, terminal zero;
`/tmp/library-http-accumulated-verify.log`). Typecheck, both query budgets,
lint and the documentation build passed. Ordinary storage passed 5,675 tests
with one existing skip; canonical storage passed 5,742. Express 4 passed 395
ordinary and 397 canonical checks. Total: **12,209 passed, zero failures,
one existing skip**. This full run covers the accumulated HTTP implementation;
native database concurrency evidence remains in the focused checkpoints below.

The public migration guide now describes connector opt-in, conditional browser
writes, CORS allow/expose headers, serialization ownership and speculative hook
responsibilities. This documentation does not close B3-06/10/11: remaining
acceptance, public declarations and executable consumer examples still need
their own evidence. No consumer repository changed.

## 2026-09-11: Speculative rendering failure and header isolation checkpoint

**124/214 complete; 90 open.** New connector tests verify that a speculative
response-hook error rolls back provisional child writes, leaves the parent
unchanged, preserves actual request metadata and runs the actual error response
hook once. Its speculative response headers do not reach the client.

Extending the test to mutate speculative request headers exposed a shared-object
leak in both connectors (`/tmp/library-http-render-headers-before.log`). The GET
view now copies normalized headers, including repeated-value arrays, using the
existing request-helpers module. This is metadata isolation; raw native objects
and application callbacks retain their documented ownership responsibilities.

The final failure/race selection passes **24 native checks**, four per
database/storage combination (`/tmp/library-http-render-headers-matrix.log`,
41101, terminal zero). Express 4 adds **two checks**, one per mode
(`/tmp/library-http-render-headers-express4-{knex,anyapi}.log`, 95649/74408,
terminal zero). All **14 helper checks** pass
(`/tmp/library-http-render-headers-helper.log`). Zero failures/skips. Typecheck
passes (68169); runtime/scenario lint and helper lint pass (52251/94482).
No full suite was rerun. Remaining rendering/API acceptance stays open.

## 2026-09-11: Computed HTTP representation acceptance checkpoint

**124/214 complete; 90 open.** Three real connector cases cover a computed field
whose nested resource query borrows the current transaction and preserves caller
context. They verify committed dependency changes invalidate the parent ETag,
transaction-local dependency changes are observed and rolled back on rejection,
and row-hidden children stay excluded from computed output and its validator.
Matching refreshed/restricted validators permit writes.

The first fixture used singular `filter` instead of the direct API's `filters`
and failed validation; its request shape was corrected. The initial two cases
then passed 24 native checks. After adding context propagation and visibility
coverage, the final selection passes **36 native checks**, six per
database/storage combination (`/tmp/library-http-computed-final-matrix.log`,
96838, terminal zero), plus **six Express 4 checks**, three per mode
(`/tmp/library-http-computed-final-express4-{knex,anyapi}.log`, 4501/16970,
terminal zero). All have zero failures/skips. Final scoped lint passes (46468).
No runtime implementation changed and no full suite was rerun. Broader rendering
contracts and the remaining B3 scope stay open.

## 2026-09-11: Response replacement and validator selection checkpoint

**124/214 complete; 90 open.** Shared connector success and error paths now
select the response hook's final body, including replacement objects, null and
cleared bodies. Strong conditional writes hash that same selected speculative
GET body. A changed replacement fails with 412; a matching replacement permits
the write. Successful empty GET responses satisfy wildcard existence without
requiring a serialized body or emitted tag.

Both real replacement cases failed before the fix
(`/tmp/library-http-replaced-body-before.log`). The replacement/validator/parity
selection then passed **282 checks per storage mode**, 564 total
(`/tmp/library-http-replaced-body-knex-final.log`, 36665;
`/tmp/library-http-replaced-body-anyapi.log`, 51942; terminal zero).
Express 4 adds one replacement case per mode (51827/72013, terminal zero).
The empty-GET wildcard regression subsequently failed before decoupling existence
from serialization (`/tmp/library-http-empty-wildcard-before.log`); the final
helper selection passes **44 checks**
(`/tmp/library-http-replaced-body-final-helpers.log`). All passing selections
have zero failures/skips. Typecheck passes (36572), and final scoped lint passes
(32982). No full suite or native database matrix was rerun for response-body
selection; transaction/database acceptance remains recorded in earlier entries.
No checklist item closes; rendering and dependency acceptance remain open.

## 2026-09-11: Checked HTTP validator contract checkpoint

**124/214 complete; 90 open.** The actual HTTP validator helper now opts into
strict checking. Its header boundary accepts unknown input; its output separates
wildcards from tag lists. Hashing accepts serialized strings/Buffers and textual
metadata, and comparison requires explicit representation existence. Read-only
type views prevent caller mutation without changing runtime object behavior.

Seven compile-time negative fixtures verify those boundaries, including absent
condition narrowing. Final typecheck passes (`/tmp/library-http-validator-contracts-final-types.log`,
30256, terminal zero), all **31 runtime helper/method-exclusion tests** pass
(`/tmp/library-http-validator-contracts-tests.log`), and scoped lint passes
(90428). The first lint run rejected a bare property-access expression in a
negative fixture; it now makes a method call while retaining the optional-value
type error. No database matrix or full suite was needed for these annotations.
Source inspection confirms there is no complete public declaration entry point
yet; this does not close A9-09 or B3-11. The checked contracts are available for
that remaining declaration work.

## 2026-09-11: Conditional handler completion checkpoint

**124/214 complete; 90 open.** A connector now requires successful completion of
its precondition callback before committing a conditional resource request. A
custom handler that forwards the transaction but drops the callback causes a
validation failure and managed rollback, preserving the original resource.

The regression failed in both connectors with 200 instead of 422 before the
change (`/tmp/library-http-callback-before.log`, 67236, terminal one). The final
selection covers that omission, accepted strong PATCH/PUT/DELETE and concurrent
same-tag PATCH. All **60 native checks** pass, ten per database/storage
combination (`/tmp/library-http-callback-matrix.log`, 12126, terminal zero).
Express 4 adds **ten checks**, five per mode
(`/tmp/library-http-callback-express4-{knex,anyapi}.log`, 3102/49559, terminal zero).
Zero failures/skips. Typecheck and scoped lint pass (27482/19894). No full suite
was rerun. This is rollback protection for a composition error; custom handlers
must still await the callback before mutation and use the supplied transaction.
B3-06/10/11 remain open.

## 2026-09-11: If-Match handling acceptance

**124/214 complete; 90 open.** B3-07 is complete. The implementation review now
defines absent, strong-list/repeated-field, weak, empty, wildcard, malformed and
oversized header behavior. OPTIONS/CONNECT/TRACE ignore If-Match. Unsupported
conditional routes reject explicitly before mutation, while absent conditions
leave POST/PATCH/PUT/DELETE unconditional with validators enabled.

The initial regression failed five cases: three shared-method checks and real
OPTIONS in both connectors (`/tmp/library-http-method-conditions-before.log`,
1846, terminal one). The shared path now excludes non-representation methods
before parsing the header. The unsupported-route error no longer describes an
unfinished implementation; it states the supported contract.

Final Node 24 verification passes **283 focused checks**: 115 ordinary
connector/helper checks and 84 canonical connector checks
(`/tmp/library-http-method-conditions-final-{knex,anyapi}.log`, 96429/82036,
terminal zero), plus 42 Express 4 checks per mode
(`/tmp/library-http-method-conditions-express4-{knex,anyapi}.log`, 34097/63570,
terminal zero). Zero failures/skips. Typecheck and final scoped lint pass
(48341/39703). No full suite or native database matrix was rerun for this HTTP
method-dispatch change; the earlier native representation/write acceptance is
recorded below. B3-06/10/11 remain open for their full scopes.

## 2026-09-11: HEAD and conditional-write ordering checkpoint

**123/214 complete; 91 open.** HEAD now shares GET's validator/precondition path
while the frameworks omit response bodies. Registered resource writers receive
a trusted private callback and evaluate it after normal document validation and
permission checks, before mutation. A stale condition no longer masks a denied
write (403) or a mismatched document ID (422). PUT preserves conditional
hidden/missing-target equivalence through its visibility-failure branch.

The HEAD regression initially failed in both connectors
(`/tmp/library-http-head-before.log`). Express had bypassed shared validators;
the fixture also needed its method-dependent representation to treat HEAD like
GET. HEAD then passed both modes and Express 4. The ordering regression initially
failed all six cases with 412 instead of 403
(`/tmp/library-http-precedence-before.log`, session 7237, terminal one).

Final Node 24 acceptance passes **552 native checks** (76 HTTP, 12 direct
version-write and four registered-route checks per each of six database/storage
combinations; `/tmp/library-http-precedence-matrix.log`, 98076, terminal zero).
Express 4 adds **76 checks**, 38 per storage mode
(`/tmp/library-http-precedence-express4-{knex,anyapi}.log`, 14669/94214, terminal
zero). All have zero failures/skips. Final typecheck and scoped lint pass
(49284/2901). No full suite was rerun.

RFC 9110 normal-check ordering was reviewed. Remaining protocol combinations,
PUT visibility/error-order review, hook/computed-field contracts, types and
consumer documentation keep B3-06/B3-07 open.

## 2026-09-11: Strong HTTP write integration checkpoint

**123/214 complete; 91 open.** Resource PUT/PATCH/DELETE now compare strong
If-Match lists with the selected GET representation inside a serializable
managed transaction, then run the registered writer in that transaction. Includes
and response-hook variants affect the comparison. Weak/empty lists fail with 412;
matching writes proceed, and failing write hooks roll back their mutation.
The speculative GET response hook uses a separate `precondition: true` context.

Node 24 passes **372 native checks**, 62 per database/storage combination
(`/tmp/library-http-strong-matrix.log`, session 15392, terminal zero). The added
simultaneous-client test passes **12 native checks**, two per combination
(`/tmp/library-http-strong-race-matrix.log`, 66868, terminal zero): one PATCH
commits, the other returns a native transaction failure, and the stored result
matches the winner. Express 4 passes **64 checks**, 32 per mode
(`/tmp/library-http-strong-express4-{knex,anyapi}.log`, 5915/57071, terminal zero).
All selections have zero failures/skips. Typecheck passes (27891); scoped lint
passes after layout-only fixes (11746). No full suite was rerun.

This remains an integration checkpoint. Hook/computed-field requirements,
authorization and normal-error precedence, HEAD behavior, dependency races,
public types and consumer documentation still need acceptance. B3-06/B3-07
remain open; native transaction failures are not yet normalized to HTTP 412.

## 2026-09-11: Serializable transaction foundation checkpoint

**123/214 complete; 91 open.** The shared transaction factory accepts an internal
symbol on the owner's context to request serializable isolation at transaction
start. PostgreSQL/MySQL use Knex's isolation configuration; SQLite uses its native
serializable behavior. Ordinary calls retain database defaults. This is not yet
wired into HTTP strong-tag writes and adds no public transaction overload.

The new two-connection test first reproduced PostgreSQL write skew: both callers
read the same available records and committed changes to different rows
(`/tmp/library-serializable-before.log`, session 19448, terminal one). With the
isolation request, exactly one commits. The other returns the native serialization,
deadlock or busy code, and the final records agree with the single committed write.

The new test and registered-route selection pass **30 native checks** (five per
database/storage combination; `/tmp/library-serializable-matrix.log`, 48745,
terminal zero). After adding exact native failure-code assertions, the new test
plus existing connection-release and completion-failure suites pass **78 native
checks** (13 per combination; `/tmp/library-serializable-lease-matrix.log`, 81560,
terminal zero). Typecheck passes (31954), and final scoped lint passes (18950).
No full suite was rerun. B3-06/B3-07 remain open for actual strong-tag integration
and its complete representation, authorization and concurrency acceptance.

## 2026-09-11: Wildcard visibility and concurrent deletion checkpoint

**123/214 complete; 91 open.** SQL row-policy tests verify that wildcard
PATCH/PUT/DELETE return the same body and status for a hidden target and the same
ID after deletion, and preserve the hidden record. Separate connections now
commit deletion after the conditional request's existence read, before its lock.
None of the three methods recreates the deleted target.

The PostgreSQL regression initially found PUT returning 404 from the lock's
not-found error instead of the 412 used for an initially missing target (two
connector failures in `/tmp/library-http-wildcard-race-pg-before.log`). The lock
now shares the existing PUT precondition-error translation. SQLite rejects its
stale snapshot's write attempt with a database-lock error (HTTP 500); this is not
claimed as a normalized 412. Its first assertion was corrected to match the
driver's emitted message rather than an absent SQL error code.

All **228 native checks** pass (38 per each of six database/storage combinations,
zero failures/skips; `/tmp/library-http-wildcard-race-matrix.log`, session 64952,
terminal zero). Express 4 passes **38 additional checks** (19 per mode;
`/tmp/library-http-wildcard-race-express4-{knex,anyapi}.log`, 30020/90210, terminal
zero). Scoped lint passes (69806). No full suite was rerun. Strong-tag writes,
representation dependency consistency and remaining B3 acceptance stay open.

## 2026-09-11: Wildcard HTTP write checkpoint

**123/214 complete; 91 open.** Opted-in resource PUT/PATCH/DELETE now evaluate
`If-Match: *` using a visible GET and the existing row lock in an `api.transaction`
that also owns the actual write. PUT cannot create a missing target (412);
missing PATCH/DELETE retain 404. Failure in the write's finish hook restores the
resource and reports a rolled-back transaction. Tag-conditioned writes and other
unsupported conditional routes still reject before mutation.

Node 24 passes **180 native checks** (26 HTTP plus four route checks per each of
six database/storage combinations) with zero failures/skips
(`/tmp/library-http-wildcard-matrix.log`, session 39447, terminal zero). Express 4
passes **26 additional checks**, 13 per mode
(`/tmp/library-http-wildcard-express4-{knex,anyapi}.log`, 10033/95883, terminal zero).
Scoped lint and typecheck pass (91313/48052). The initial DELETE test failed
because the fixture response hook assumed a body; that fixture now allows an
empty response. No full suite was rerun.

These checks do not establish concurrent-deletion safety, hidden-target
acceptance, or full strong-validator write support. B3-06/B3-07 stay open.

## 2026-09-11: Registered resource route transaction checkpoint

**123/214 complete; 91 open.** Resource route handlers forward an explicit
connector-supplied transaction into the existing resource methods. HTTP body,
headers and query parameters do not supply this handle. Real registered handlers
verify provisional PATCH/PUT/DELETE, transaction-local GET/query visibility,
caller rollback, and POST completion by its owner.

All **24 native checks** pass on Node 24: four per SQLite/PostgreSQL/MySQL and
ordinary/canonical combination, no failures or skips
(`/tmp/library-route-transactions-matrix.log`, session 64747, terminal zero).
Scoped lint and typecheck pass (66776/52996). Conditional HTTP writes are still
guarded until representation selection and atomic comparison are integrated;
this does not close B3-06/B3-07. No full suite was rerun.

## 2026-09-11: GET If-Match acceptance checkpoint

**123/214 complete; 91 open.** Opted-in GET now accepts matching strong tags,
lists and wildcard conditions. Weak, nonmatching and empty lists return 412 with
`REST_API_PRECONDITION_FAILED`, without disclosing the current tag. Normal
missing-resource errors remain 404; malformed conditions return 422. Changed
response-hook output fails an earlier representation's condition. Non-GET
conditions still reject before mutation while transaction integration is pending.

Node 24 focused checks pass: 14 ordinary connector cases and 42 canonical
connector/helper cases, plus seven Express 4 cases per storage mode, **70 total**.
Logs: `/tmp/library-http-get-conditions-{knex,anyapi}.log` and
`/tmp/library-http-get-conditions-express4-{knex,anyapi}.log`. Scoped lint and
typecheck passed. These results do not establish conditional-write support or
close B3-06/B3-07. No full suite was rerun.

## 2026-09-11: Connector ETag emission checkpoint

**123/214 complete; 91 open.** The opt-in connector path serializes a successful
GET once after response hooks, hashes it and sends those exact bytes. Real
Express/Fastify tests verify header/body agreement, response-hook changes and
included child changes. Transformed PUT emits no new validator; Express's
automatic ETag is suppressed for opted-in PUT. Defaults stay off. If-Match
temporarily fails validation before the resource handler until atomic selected-
representation evaluation is integrated; B3-06/B3-07 are not complete.

The new cases plus connector parity pass **190 tests per storage mode, 380
total**, zero failures/cancellations/skips
(`/tmp/library-http-validator-emission-{knex,anyapi}.log`, sessions 51529/9639,
terminal zero). Express 4 adds **four per mode, eight total** (sessions
60294/13320, terminal zero). Typecheck and scoped lint pass (98859/55423).
The initial run found test assumptions about validation status (422, not 400)
and Fastify's required PUT document ID; those inputs/assertions were corrected.
No full suite was rerun; native database coverage for conditional HTTP writes
remains part of subsequent integration acceptance.

## 2026-09-11: Serialized ETag helper checkpoint

**123/214 complete; 91 open.** The validator helper now hashes serialized
representation bytes plus content type/encoding. It rejects objects instead of
implicitly invoking serialization. Tests verify identical UTF-8 bytes match,
while changed included/computed data, byte layout, format and metadata produce
different tags even when a resource revision is unchanged.

All **28 focused Node 24 tests** pass (`/tmp/library-http-etag-bytes.log`), and
scoped lint passes (session 87165). The connector review found Express and
Fastify still serialize response objects independently. No ETag is emitted yet;
the opted-in path must send the same serialized bytes that were hashed and
evaluate preconditions inside the mutation transaction. B3-06/B3-07 remain open.
No database or full-suite run was needed for this pure helper change.

## 2026-09-11: HTTP validator grammar checkpoint

**123/214 complete; 91 open.** A connector-local helper parses bounded If-Match
input and evaluates strong matches. The focused suite covers missing/empty
conditions, wildcard existence, repeated fields, lists, weak tags, exact matching,
opaque commas/backslashes/octet values, malformed syntax and limits.
All **24 Node 24 tests** pass in `/tmp/library-http-validators.log`; scoped lint
passes (session 8868). No database matrix is needed for this pure parsing step.

RFC 9110 was checked directly; the implementation review links the relevant
sections. The helper is deliberately not connected to routes yet: representation
validation and transaction integration remain required before B3-06/B3-07 can
close. These tests do not establish end-to-end HTTP conditional-write support.
No full suite was rerun.

## 2026-09-11: Conditional failure side-effect acceptance

**123/214 complete; 91 open. B3-08 is complete.** New real-client cases cover
a successful relationship change followed by a stale write inside a caller
transaction, and atomic bulk PATCH/DELETE where a later child is stale. Rollback
restores parent/membership state and emits no committed update over WebSocket
or polling. File cases cover earlier successful PATCH/PUT uploads followed by
a stale write: rollback deletes both provisional/rejected new files, cleans
temporary files and preserves the original attachment and revision.

The combined suites pass **144 native checks** (24 per database/storage
combination), zero failures/cancellations/skips
(`/tmp/library-version-transaction-effects-matrix.log`, session 73888, terminal
zero). Scoped lint passes (session 35657). The first notification test attempt
imported BulkOperationsPlugin from the root, which does not export it; the test
now uses its existing module export. Production code is unchanged. Previous
evidence below verifies rejected writes run no success/commit hooks and accepted
controls do run hooks and reach real clients. Earlier successful operations can
run pre-commit hooks; irreversible application effects must wait for commit.
No full suite was rerun for these focused additions.

## 2026-09-11: Conditional notification suppression

**122/214 complete; 92 open.** A new real Socket.IO conformance suite subscribes
to a versioned parent over WebSocket and polling. Stale PATCH/PUT/DELETE and all
three relationship methods emit no committed update and preserve both parent
state and membership. Each case then submits the current token and verifies
that the accepted write reaches the subscribed client. Shared socket packet
barriers establish ordering without sleep-based absence assertions. Clients,
servers and fixture databases close after each suite.

All **72 native checks** pass (12 per database/storage combination), with no
failures/cancellations/skips (`/tmp/library-version-notifications-matrix.log`,
session 80537, terminal zero). Scoped lint passes (session 25287). Production
code is unchanged. B3-08 remains open for conditional failure after earlier
successful children in a caller-managed or atomic bulk transaction; direct
failure hooks, uploads and real notifications now have focused evidence.
No full suite was rerun.

## 2026-09-11: Conditional upload cleanup acceptance

**122/214 complete; 92 open.** The existing file fixture can now opt into a
stored revision. New conformance cases exercise stale PATCH and PUT uploads in
both JSON:API and plain formats. Rejection cleans detector temporary files,
deletes any newly uploaded file, preserves the original attachment and stored
revision, and does not prevent a later valid-token replacement from succeeding.
The tracking storage checks live files as well as upload/delete calls.

All **24 native checks** pass (four per database/storage combination), zero
failures/cancellations/skips (`/tmp/library-version-files-matrix.log`, session
41844, terminal zero). Scoped lint passes (session 78881). Only the shared test
fixture and new test file changed; production code is unchanged. B3-08 remains
open for actual committed-change notification and broader failure-side-effect
acceptance. No full suite was rerun.

## 2026-09-11: Conditional failure hook acceptance

**122/214 complete; 92 open.** Stale direct PATCH/PUT/DELETE and all three
relationship methods now explicitly verify that neither `afterDataCall` nor
`afterCommit` runs. The successful conditional PATCH control confirms that both
observers are installed and active; rejected operations still preserve the
existing stored-state and error-visibility assertions.

The focused suite passes **114 native checks** (19 per database/storage
combination), zero failures/cancellations/skips
(`/tmp/library-version-side-effects-matrix.log`, session 2379, terminal zero).
Scoped lint passes (session 41171). Production code is unchanged. B3-08 remains
open for file cleanup, committed-change notification and broader failure-side
effect acceptance. No full suite was rerun.

## 2026-09-11: Atomic version condition acceptance

**122/214 complete; 92 open. B3-04 is complete.** The implementation audit
confirms expected-version byte comparison and fresh-token assignment share one
adapter-scoped SQL UPDATE inside the public write transaction. There is no
JavaScript read/compare/write version check. Existing public authorization and
SQL row-policy reads precede that condition; the primitive does not replace
application authorization or promise atomic evaluation of arbitrary callbacks
against external authorization changes.

Evidence combines the existing concurrent same-token winner/loser and rollback
tests with the 69-check tenant/resource overlap selection below. New SQL policy
tests cover direct PATCH/PUT/DELETE and all three relationship methods. Hidden
rows reject current and stale tokens identically, preserve stored state, and
produce the same HTTP-mapped error as missing rows. All **108 native checks**
pass (18 per combination), no failures/cancellations/skips
(`/tmp/library-version-sql-policy-matrix.log`, session 37136, terminal zero).
Scoped lint passes (session 9266). The first SQLite attempt failed because the
new policy callback omitted its required `return true`; the corrected fixture
passes. No production change was needed for this acceptance step.

Broader relationship race and side-effect coverage remains under B3-08/B3-10;
HTTP validators and their representation dependencies remain under B3-06/B3-07.
The existing raw-SQL/trigger revision-maintenance contract still applies. No
full suite was rerun for this focused test addition.

## 2026-09-11: Conditional canonical write scope

**121/214 complete; 93 open.** Public PATCH, PUT and DELETE now have scope
regressions with foreign-tenant and foreign-resource rows sharing both the
selected ID and its revision. A matching conditional write preserves those
foreign records. A subsequent stale condition still matches foreign tokens but
must fail for the selected resource, leaving its current state and all foreign
rows unchanged. DELETE recreates the selected ID before the stale-condition
check. Tests use the existing storage-adapter seed helper.

The focused atomic revision suite passes **69 native checks** (10 ordinary and
13 canonical per database), zero failures/cancellations/skips
(`/tmp/library-version-scope-matrix.log`, session 20636, terminal zero).
Lint initially flagged object-property layout; the whitespace-only correction
passes scoped lint (session 93624). Production code is unchanged. Existing
visibility tests use a boolean policy; explicit SQL row-policy conditions and
broader relationship races remain to be reviewed under B3-04/B3-10. No full
suite was rerun for this test addition.

## 2026-09-11: Canonical deletion scope acceptance

**121/214 complete; 93 open.** Canonical deletion tests now populate foreign
tenant and foreign resource records/links with the same logical IDs as the
selected member and parent. Deleting either end preserves every foreign record
and link, including stored foreign revision values. Deleting the member still
invalidates its selected surviving parent; deleting the parent preserves the
member resource. Existing fixture seed helpers provide the overlapping rows.

The focused deletion suite passes **18 native checks** (three per combination)
with no failures/cancellations/skips (`/tmp/library-delete-scope-matrix.log`,
session 64572, terminal zero). Ordinary combinations cover SQL constraints and
unversioned cleanup; canonical combinations cover both overlap directions and
unversioned cleanup. Scoped lint passes (session 27403). Production code is
unchanged; no full gate was rerun. Conditional-write scope and broader race
acceptance remain under B3-04/B3-10.

## 2026-09-11: Version invalidation contract

**121/214 complete; 93 open. B3-02 is complete.** The migration guide now
specifies initialization, UUID representation/rotation, PUT-create, direct
writes, direct/inverse relationship membership, deletion/recreation, bulk,
rollback and JSON:API/plain visibility in one revision-behavior table.
Included child attributes do not make the parent token a representation hash.
Raw SQL, arbitrary triggers and transitive database cascades require application
revision maintenance; direct declared pivot CASCADE/RESTRICT behavior is covered
by the preceding acceptance. This closes the contract specification, not the
remaining race, tenant, side-effect, HTTP or public-type implementation items.

The expanded direct-write suite passes **12 checks per native database/storage
combination, 72 total**, no failures/cancellations/skips
(`/tmp/library-repeated-versions-matrix.log`, session 59236, terminal zero).
New cases cover unchanged-value PATCH rotation, successive conditional writes
inside one caller transaction, stale-token rejection without overwriting that
transaction's current value, and rollback to the original revision. Both output
formats run each case. Scoped lint passes (session 70140). Production code is
unchanged. Broader concurrency/tenant acceptance remains in B3-04/B3-10.

Per the maintainer's revised cadence, these focused checks do not trigger another
full gate. Full suites remain required at substantial milestones and final
acceptance; the preceding accumulated verification is recorded below.

## 2026-09-11: Accumulated inverse-write verification

**120/214 complete; 94 open.** The remaining gate finishes with status zero
(`/tmp/library-inverse-remaining-gate.log`, session 18738): **5,558 canonical
tests**, **395 ordinary Express 4 tests**, **397 canonical Express 4 tests**,
whole-project lint and docs all pass. All 313 source hashes match
`/tmp/library-inverse-remaining-source.json` after completion.

The preceding aggregate command passed types and both query budgets, then
reported 5,495 ordinary passes, one existing skip and one historical assertion
expecting orphaned pivots. The corrected custom-ID file passes all 18 tests in
both modes. Only that assertion changed between the aggregate snapshot and the
remaining-stage snapshot; production sources stayed fixed. This is split-run
evidence after resolving the sole ordinary failure, not a claim that the failed
`npm run verify` invocation returned zero. Its logs and failure are retained
below. Native deletion acceptance adds the separately recorded 126 inverse/
relationship checks and 12 constraint/unversioned checks.

The migration guide now summarizes revision behavior in one table and explicitly
identifies automatic ordinary pivot cleanup as a change from previous releases.
Further invalidation/concurrency acceptance remains open under B3-02.

## 2026-09-11: Deletion constraints and unversioned memberships

**120/214 complete; 94 open.** Native acceptance now verifies ordinary SQL
RESTRICT rejects member deletion without changing the record, membership or
parent revision, and SQL CASCADE deletes the pivot while the public write
invalidates its surviving parent. Independent raw SQL probes establish that
the constraints themselves are active. The shared fixture has an optional
ordinary pivot foreign-key rule; production code is unchanged in this step.

Unversioned coverage verifies deletion/recreation at either end removes old
links and preserves unrelated memberships. The new suite passes **12 checks**:
three ordinary plus one canonical per database, with no failures/skips or
cancellations (`/tmp/library-delete-constraints-matrix.log`, session 80046,
terminal zero). Scoped lint also passes (session 88881). Canonical links do not
use ordinary pivot foreign keys; only ordinary storage runs those SQL rule
cases. Transitive cascades, tenant-overlap deletion and concurrent deletion
still need acceptance. B3-02 remains open.

The accumulated full gate first stopped at the bulk-delete query budget:
ordinary task deletion now uses six statements rather than five for one atomic
record, including required pivot cleanup. The per-record bulk-delete allowance
is updated by exactly one statement in each mode (ordinary 3→4, canonical 2→3);
transaction overhead and all other budgets are unchanged. The failed gate is
`/tmp/library-inverse-accumulated-gate.log`, session 95806, terminal one.
The replacement gate (session 65815) ended with status one after typecheck and
both budgets passed. Ordinary tests reported 5,495 passes, one failure and one
existing skip: the custom-ID deletion test explicitly expected dangling pivots.
This was a deliberate historical behavior, now changed by the documented link
cleanup contract. Its assertion now requires zero pivots and still verifies
the related author survives. That complete 18-test file passes in both storage
modes (`/tmp/library-delete-custom-ids-{knex,anyapi}.log`, canonical session
26312, terminal zero). No production changes followed the failed gate.

The failed gate output is `/tmp/library-inverse-accumulated-gate-final.log`.
All 313 source hashes matched while it ran; its checkpoint is
`/tmp/library-inverse-accumulated-source.json`. The corrected assertion is the
only subsequent source change. Remaining canonical/Express 4/lint/docs stages
must still complete; do not describe the failed aggregate command as passing.

## 2026-09-11: Deleted-member revision and link cleanup

**120/214 complete; 94 open.** Resource deletion now invalidates surviving
versioned many-to-many parents before deleting the source. After successful
resource deletion, ordinary storage removes declared pivot references and
canonical storage removes both link orientations scoped by tenant/resource/ID.
This prevents old memberships from reconnecting when the deleted ID is reused.
The regression also verifies caller rollback restores membership and revisions.

Both storage modes reproduced membership resurrection before cleanup in
`/tmp/library-delete-recreation-{knex,anyapi}.log`. The final inverse and
versioned-relationship selection passes **21 checks in each of six native
combinations, 126 total**, with no failures/cancellations/skips
(`/tmp/library-delete-cleanup-matrix.log`, session 42322, terminal zero).
Node 24 typecheck, scoped lint and the migration-guide build also pass in
`/tmp/library-delete-cleanup-{types,lint-final,docs}.log` (typecheck session
61752, lint 38062, docs 9578, all terminal zero). An initial attempt used the
nonexistent `test:types` script; the recorded successful check uses `typecheck`.

B3-02 remains open: explicit SQL RESTRICT/CASCADE behavior, transitive cascade
effects, broader deletion concurrency and unversioned cleanup scope still need
acceptance coverage. The latest full gate predates these inverse changes.

## 2026-09-11: Direct pivot-resource revision acceptance

**120/214 complete; 94 open.** The existing reference tracker now recognizes
ordinary many-to-many through resources and captures both foreign keys. Direct
pivot creation, member replacement, reparenting and deletion invalidate affected
versioned parents. Both pivot data and parent revisions roll back with the caller.
Canonical through-resource records remain separate from canonical links; the
shared test verifies they leave canonical membership and its revision unchanged.
The concurrency and migration guides describe that existing storage distinction.

The initial ordinary regression fails because pivot creation changes membership
without changing the parent revision (`/tmp/library-pivot-versions-before.log`).
The expanded inverse suite passes **14 per native combination, 84 total**, zero
failures/cancellations/skips (`/tmp/library-pivot-versions-matrix.log`, session
57695, terminal zero). A later focused selection adds ordinary pivot-delete
rollback assertions and passes **6 more checks** across all combinations
(`/tmp/library-pivot-versions-rollback-matrix.log`, session 19806, terminal zero).
Types and scoped lint pass in `/tmp/library-pivot-versions-{types,lint}.log`.
The preceding many-to-many documentation build passed (session 9465).

This is a small extension of the existing reference capture/comparison, not a
new pivot mutation path. Source-resource deletion and database cascade effects
remain open; B3-02 is not yet complete. The prior full gate predates these inverse
revision changes; the evidence above is their targeted native verification.

## 2026-09-11: Many-to-many inverse revisions

**120/214 complete; 94 open.** Ordinary pivot and canonical link writers now
invalidate configured versioned inverse resources on attachment, replacement and
removal. Removed-link reads are paged; CASE updates assign distinct UUIDs in
batches of at most 100 target IDs. Direct link helpers reject missing/completed
transactions before maintaining versioned inverse metadata. The relationship
processor now retains its target resource name, and relationship POST passes its
complete definition into the existing ordinary pivot helper.

The first selection had **6 failures and 5 passes** before this change, logged
in `/tmp/library-many-inverse-before.log`. An initial applied ordinary run
identified the discarded target metadata; canonical cases already passed. After
that fix, the 18-case native selection passed **108 checks**. The final selection
adds missing-transaction checks for direct attach/replacement/removal and passes
**19 per native combination, 114 total**, with zero failures/cancellations/skips.
The 205-member case verifies bounded updates and bindings, unique new tokens,
rollback, removal and unaffected unrelated resources.

Final native evidence: `/tmp/library-many-inverse-acceptance.log` (session 47508,
terminal zero). Earlier evidence: `/tmp/library-many-inverse-matrix.log`,
`/tmp/library-many-inverse-{knex,anyapi}.log` and
`/tmp/library-many-inverse-knex-fixed.log`. Typecheck passes in
`/tmp/library-many-inverse-types.log`.

Existing large pivot/attachment/deletion regressions pass **77 tests**, with
zero failures/cancellations/skips, in session 16817 (terminal zero), logged at
`/tmp/library-many-inverse-large-regressions.log`. Those suites explicitly select
ordinary or canonical storage, so one outer run covers both. Both query-budget
modes pass in session 50060 (`/tmp/library-many-inverse-budgets.log`); final scoped
lint passes in session 4372 (`/tmp/library-many-inverse-complete-lint.log`). The preceding
inverse-reference docs build passed (session 13370). Direct pivot resource writes,
source deletion/cascades and complete invalidation acceptance remain open.
No additional checklist item closes in this step.

## 2026-09-11: Inverse reference version invalidation

**120/214 complete; 94 open.** Three new regressions demonstrate that child
creation/reparenting/deletion previously left parent revisions unchanged,
allowing stale parent relationship replacement. Existing resource write methods
now capture actual stored ordinary/polymorphic references and invalidate affected
configured parents after storage mutation, within the same transaction. The
existing version module and storage adapters own this work. Attribute-only child
edits retain parent revisions; caller rollback restores both child and parent.

The native inverse/direct-write/relationship/error selection passes **33 tests
per combination, 198 total**, no failures/cancellations/skips. Evidence:
`/tmp/library-inverse-versions-before.log` (3 failures),
`/tmp/library-inverse-versions-matrix.log` (session 94444, terminal zero).
The expanded PUT fixture explicitly supplies persisted default values under the
existing complete-replacement contract. Relationship setup refreshes the parent
token after seeding linked children. Types and scoped lint pass in
`/tmp/library-inverse-versions-types.log` and
`/tmp/library-inverse-versions-final-lint.log`.

Lifecycle/write-failure regressions pass **951 per mode, 1,902 total**, zero
failures/cancellations/skips, in sessions 94646/25382 (terminal zero), with logs
`/tmp/library-inverse-lifecycle-{knex,anyapi}.log`. Both query-budget modes pass
in session 28447 (terminal zero), logged at `/tmp/library-inverse-version-budgets.log`. The prior full gate predates
this inverse invalidation change. Many-to-many/pivot writers, cascades, complete
concurrent reference coverage and the full B3-02 invalidation contract remain
open; no additional checklist item closes here.

## 2026-09-11: Version-field migration acceptance

**120/214 complete; 94 open. A93/138, B25/48, M2/14, C0/14.** B3-03 is
complete. The [migration guide](../GUIDE/version-field-migration.md) and
`examples/migrations/resource-versions.js` provide explicit field allocation,
physical-ID pagination, per-row UUID initialization, retry, invalid-data/caller
rollback, canonical scope requirements and deployment readiness. The main API
migration guide links this procedure. It is a one-off SQL migration example,
not an exported runtime helper or implicit schema mutation.

Six cases pass in each SQLite/PostgreSQL/MySQL storage combination: **36 total**,
zero failures/cancellations/skips. The final matrix is
`/tmp/library-version-migration-acceptance.log` (session 50762, terminal zero).
Tests cover 103 rows, retained tokens, rollback, scoped rows and overlapping
canonical tenants/resources, explicit field addition, restart, stale updates
and new record initialization. Existing field-configuration tests separately
cover visibility; the example does not change that configuration.

Earlier draft runs caught test setup issues: ordinary restart must skip table
creation, explicit canonical maps require every stored field, and an explicit
PostgreSQL seed ID does not advance its generated-ID sequence. The shared
fixture now accepts `createTable: false`, defaulting to its prior true behavior;
the restart test seeds a generated ID. No library runtime fix was needed for
those setup failures. Logs are `/tmp/library-version-migration-knex.log`,
`/tmp/library-version-migration-matrix.log` and
`/tmp/library-version-migration-final-matrix.log`.

The Express 4 package scripts now include the new bulk HTTP test selection;
their expanded run passed **395 ordinary and 397 canonical checks (792 total)**,
zero failures/cancellations/skips, in session 54273 (terminal zero), logged at
`/tmp/library-bulk-version-express4-gate.log`. The supplemental six new cases
already passed separately. Scoped lint including the normally ignored example
passes (`/tmp/library-version-migration-final-lint.log`), as does the docs build
(`/tmp/library-version-migration-docs.log`, session 63974, terminal zero). The prior accumulated gate remains valid for its
309-file checkpoint; these migration files, the fixture option and the script
selection are subsequent changes, not retroactively covered by that gate.

## 2026-09-11: Accumulated version-write gate passed

The completed Node 24 `npm run verify` gate passes **11,794 tests**:
5,472 ordinary-storage tests, 5,536 canonical-storage tests and 392/394 Express 4
checks. There are zero failures/cancellations and one existing ordinary skip.
Types, both query-budget modes, lint and documentation generation also pass.
Session 59952 is terminal zero; output is
`/tmp/library-versioned-accumulated-gate.log`. All **309 source hashes** in
`/tmp/library-versioned-bulk-source.json` matched after completion, before the
separate migration example/tests and fixture restart option were applied.

This gate covers the accumulated diagnostic policy/pre-copy fixes and direct,
relationship and bulk revision implementation. The new bulk HTTP conditions
also pass a supplemental Express 4 selection: **3 per storage mode, 6 total**,
zero failures, in `/tmp/library-bulk-version-express4-{knex,anyapi}.log`.
The package's Express 4 gate selection has not yet been expanded to include
that new file; the supplemental results above cover it explicitly.

The migration example and its test file were added after this gate. Their
verification is separate; no full-gate success is claimed for those later files.

## 2026-09-11: Version migration preparation

B3-03 remains open. The [migration draft](../GUIDE/version-field-migration.md) now records
explicit field allocation, canonical tenant/resource scoping, nullable data-phase
backfill, retry/rollback rules, visibility and deployment readiness. Ordinary
`addKnexFields` performs DDL without refreshing the live declaration; canonical
allocation refreshes its descriptor, and canonical `alterKnexFields` remains
unsupported. The guide accounts for these existing differences.

A bounded backfill example is prepared at
`/tmp/library-version-backfill-draft.js`; it has not yet been applied or tested.
It uses the caller's raw Knex transaction, physical unique-ID pagination and
per-row UUIDs, preserving existing valid tokens and rejecting malformed values.
The current full verification gate remains session 59952; runtime/test sources
are held fixed while it runs. Its ordinary-storage suite has passed 5,472 tests
with one existing skip. Canonical storage and later gate stages are still running.
Migration tests are drafted at `/tmp/library-version-backfill-tests-draft.js`,
covering pagination, retry, invalid-value/caller rollback, scoped records and
allocation followed by restart. These drafts have not been executed. The new
bulk HTTP cases also need an explicit Express 4 selection after this gate. Next: finish that exact run, compare its source
checkpoint, then test the migration example on the native matrix before marking
migration guidance complete.

## 2026-09-11: Bulk revision conditions

**119/214 complete; 95 open.** B3-10 remains open for the broader versioned
transaction/relationship/HTTP acceptance. Bulk PATCH and DELETE now accept
`expectedVersions` aligned with their existing operations/IDs. All tokens are
validated and copied before child work, then passed through the existing
single-write API. Bulk POST rejects conditions; singular bulk conditions,
unversioned targets and malformed arrays reject before non-atomic work.
HTTP bulk bodies forward the array through both connectors.

The initial 18 direct regressions had **14 failures and 4 passes** before the
runtime change. The final 33 new cases include atomic rollback, non-atomic
partial success with indexed typed errors, matching/unconditional writes,
malformed/sparse arrays, caller rollback, repeated targets, unversioned targets
and real Express/Fastify body conditions. Combined with existing bulk failure
and authorization suites, **142 tests pass per database/storage combination,
852 total**, with zero failures/cancellations/skips across SQLite, PostgreSQL
and MySQL on Node 24. Scoped lint, typecheck and whitespace checks pass.

Evidence: `/tmp/library-versioned-bulk-before.log`,
`/tmp/library-versioned-bulk-final-matrix.log` (session 6671, terminal zero),
`/tmp/library-versioned-bulk-lint.log`, `/tmp/library-versioned-bulk-types.log`.
The earlier 28-case native selection also passed all six combinations (168
checks). HTTP validation assertions use the existing 422 contract.

The accumulated `npm run verify` gate is running as session 59952, with output
in `/tmp/library-versioned-accumulated-gate.log`. Its source checkpoint contains
309 files in `/tmp/library-versioned-bulk-source.json`. No full-gate success is
claimed yet. The preceding conflict-error documentation build completed with
exit zero (session 97498). Consumer repositories remain untouched.

## 2026-09-11: Version conflict errors and visibility acceptance

**119/214 complete; 95 open. A93/138, B24/48, M2/14, C0/14.** B3-05 is
complete. Exported `RestApiVersionConflictError` has stable code
`REST_API_VERSION_CONFLICT`, preserved through write wrappers with the typed
original cause. HTTP mapping uses 409 and the stable code without expected or
current token values. A privacy regression found conditional PUT-create returned
conflict while the same policy-hidden ID returned not found; both now return
the same not-found response.

The initial six direct error tests had four failures and two passes. The final
twelve error cases cover direct PATCH/PUT/DELETE and all three relationship
methods, including public error import/identity, rollback, unchanged stored data
and identical hidden/missing mapped responses. Error, direct-write and relationship
suites pass **28 per native driver/storage combination, 168 total**, zero
failures/cancellations/skips. Existing real HTTP parity/formatter selections pass
**193 per storage environment, 386 total**. Types, scoped lint and whitespace pass.

Logs: `/tmp/library-version-errors-before.log`,
`/tmp/library-version-errors-matrix.log` (session 90304, terminal zero),
`/tmp/library-version-error-http-{knex,anyapi}.log`, and
`/tmp/library-version-errors-types.log`. The new error mapping is not If-Match
support. Remaining bulk/HTTP conditions, indirect invalidation and migration
acceptance are still open. The preceding relationship docs build passed
(session 48523).

## 2026-09-11: Relationship endpoint revision conditions

Three initial has-many regressions fail: relationship PATCH drops the supplied
condition, while POST/DELETE leave the parent revision unchanged. PATCH now
forwards the condition to its existing PATCH composition; POST/DELETE reuse the
atomic revision helper in their current transaction. Versioned rows need no
additional parent-lock update; unversioned paths retain that helper.

The expanded shared fixture covers has-many and many-to-many for all three
methods, checking rotation, stale rejection and unchanged final membership.
It passes **6 per driver/storage combination, 36 total**, zero failures,
cancellations or skips on SQLite/PostgreSQL/MySQL. Existing related-read,
relationship-permission and cleanup selections pass **153 per storage mode,
306 total**, also clean. Scoped lint, types and whitespace pass.

Logs: `/tmp/library-versioned-relationships-before.log`,
`/tmp/library-versioned-relationships-matrix.log` (terminal session 33957),
`/tmp/library-versioned-relationship-regression-{knex,anyapi}.log`, and
`/tmp/library-versioned-relationship-types.log`. The existing query fixture now
accepts optional group resource overrides; default callers retain their prior
configuration. No consumer or dependency changes occurred.

This covers parent endpoint conditions, not every indirect/inverse invalidation,
polymorphic interaction or bulk operation. No additional checkbox closes.
**118/214 complete; 96 open.** The preceding public-concurrency docs build passed
(session 53111).

## 2026-09-11: Public concurrent revision acceptance

**118/214 complete; 96 open. A93/138, B23/48, M2/14, C0/14.** B3-09 is
complete. Public PATCH calls synchronize at a before-data hook after acquiring
separate transactions. Both send the same revision. Exactly one succeeds and
runs the successful-write hook; the final attributes and revision match that
winner. Both JSON:API and plain cases execute on all three real drivers in
both storage modes. The ten-case direct-method suite passes **60 checks**,
zero failures/cancellations/skips (`/tmp/library-public-version-concurrency.log`,
terminal session 90311). SQLite allows its native busy rejection; PostgreSQL
and MySQL require the version-conflict subtype.

An isolated Node import-hook mutation removes only the expected-token SQL
predicate. On PostgreSQL/ordinary storage, four tests pass and six fail as
expected, including both public races observing **two successes instead of one**.
The runner stops on that failed mode; no canonical mutation result is claimed.
This proves the race assertions depend on the predicate, rather than merely
passing because a database serializes writes. Logs and loader:
`/tmp/library-public-version-predicate-mutation.log`,
`/tmp/library-version-predicate-loader.mjs`. Production source is unchanged by
that mutation. Scoped lint and whitespace pass. Public fixture pool/concurrency
settings are explicit; related/bulk/HTTP and permission acceptance remain open.
The preceding direct-write docs build passed (session 25056).

## 2026-09-11: Direct resource version conditions integrated

**117/214 complete; 97 open. A93/138, B22/48, M2/14, C0/14.** B3-01 is
complete: explicit `versionField` and `expectedVersion` are selected and verified
for direct resource calls. Initialization injects a UUID into an owned input copy
before validation; existing mutations rotate the version conditionally within
the operation transaction. A locally retained token is restored after setters.
Submitted version attributes and conditional creation reject.

Configuration, storage primitive and direct-method tests pass **30 per native
driver/storage combination, 180 total** on SQLite/PostgreSQL/MySQL, zero failures,
cancellations or skips. Both response formats cover required-field creation,
stale PATCH/DELETE, unconditional PUT, no caller-input mutation, hook token
replacement and rollback after a failing write hook. Existing lifecycle/cleanup
checks pass **845 per storage environment, 1,690 total**, also without failures,
cancellations or skips. Scoped lint, types and whitespace pass.

Logs: `/tmp/library-versioned-writes-matrix.log` (session 95808, terminal zero),
`/tmp/library-versioned-lifecycle-{knex,anyapi}.log`,
`/tmp/library-versioned-writes-types.log`. The [implementation review](optimistic-concurrency.md)
states the selected API and remaining acceptance: public concurrent clients,
permissions/non-disclosure, relationship/bulk participation, file/event effects,
explicit migrations, types and HTTP validators. This is not whole-B3 completion
or a replacement for the full library gate. Consumer repositories are untouched.
The earlier exact-condition docs build passed (session 44830).

## 2026-09-11: Exact revision conditions and overlapping transactions

The native MySQL baseline exposed a trailing-space match: eight checks passed,
one failed because `initial ` matched stored `initial`. The helper now compares
bytes using each supported driver's SQL, retaining bound identifiers/values.
Nine cases pass in both modes on SQLite/PostgreSQL/MySQL (**54 passes**).

The shared fixture then enabled separate pooled connections and added a barrier
inside two simultaneously acquired transactions. Both attempt the same token;
exactly one succeeds, the other rejects, and the winner's token remains stored.
The expanded matrix passes **10 per driver/mode, 60 total**, zero failures,
cancellations or skips. SQLite permits its native busy rejection; PostgreSQL
and MySQL require the version-conflict error. Scoped lint and whitespace pass.
Logs: `/tmp/library-version-collation-before.log`,
`/tmp/library-version-collation-matrix.log`, and
`/tmp/library-version-concurrency-matrix.log` (terminal session 25562).
The previous resource-version docs build also passed (session 88755).

This is storage-primitive evidence. Public-method initialization, conditions,
authorization/error classification, lifecycle side effects and HTTP integration
remain unfinished; no B3 checkbox closes. **116/214 complete; 98 open.**

## 2026-09-11: Atomic revision storage primitive

The new small writing helper uses the existing adapter's scoped base query and
physical field mapping for one conditional revision update in the caller's
transaction. It returns a fresh UUID and uses existing validation/resource-error
classes. Seven shared storage-level cases pass per SQLite mode, **14 total**,
zero failures/cancellations/skips: matching/stale tokens, unconditional rotation,
rollback and malformed arguments. Logs: `/tmp/library-resource-version-{knex,anyapi}.log`.

This is not public-method integration or genuine simultaneous-client coverage.
The implementation review explicitly retains collation-sensitive comparison,
initialization, input protection, mutation integration and error/privacy semantics
as unfinished work. All B3 items remain open. **116/214 complete; 98 open.**
The preceding version-configuration docs build passed (session 54605).

## 2026-09-11: Explicit version-field compilation

Compilation now validates and publishes an explicit `versionField` pointing to
an existing stored string attribute. It rejects primary IDs, missing/numeric
fields, relationships, derived fields and getter/setter/storage-serializer
transforms. Visibility is unchanged. The selected storage direction is opaque
revision tokens; generation, submitted-value protection, expected-version
predicates and the full method/HTTP contracts remain unimplemented. This
configuration groundwork does not provide concurrency protection yet.

Ten initial regressions fail before the change. The final twelve-case version
suite plus existing schema-enrichment tests pass **51 ordinary + 70 canonical
= 121**, zero failures/cancellations/skips. Scoped lint and type checking pass.
Logs: `/tmp/library-version-configuration-before.log`,
`/tmp/library-version-configuration-knex.log`,
`/tmp/library-version-configuration-anyapi-final.log`, and
`/tmp/library-version-configuration-types.log`. The differing totals come from
existing mode-specific schema-enrichment selections. No consumer, dependency or
application table migration was performed. All B3 items remain open.
**116/214 complete; 98 open.**

## 2026-09-11: Optimistic concurrency boundary review started

The [B3 implementation review](optimistic-concurrency.md) records the existing
PATCH/PUT/DELETE storage owners, affected-row differences, empty-update behavior,
relationship locks and canonical double-valued numeric slots. No existing
version-condition/ETag implementation was found in maintained runtime/tests.
RFC 9110 sections 8.8.1, 13.1.1 and 9.3.4 were checked for strong validators,
If-Match evaluation and transformed PUT responses. This changes the design work:
a row counter must not be presented as a representation-wide strong validator.
The stored-version representation and complete mutation/invalidation rules still
need selection and implementation. All B3 items remain open; no supported API
was added by the review. **116/214 complete; 98 open.**

The preceding logger metadata documentation build passed (session 30805,
`/tmp/library-logger-precopy-docs.log`).

## 2026-09-11: Logger metadata respects redaction before copying

Three counter-based regressions expose eager metadata reads by convenience
methods and error envelopes, including classification of a protected `error`
key. All three fail against the previous enhanced logger (six existing tests
pass), using the isolated prior-source loader. Applied checks pass **73 per
storage environment, 146 total**, zero failures/cancellations/skips; scoped lint
passes. The formatter now processes metadata before object spreading. No
second serializer or runtime compatibility path was added.

Logs: `/tmp/library-logger-precopy-strengthened-before.log` and
`/tmp/library-logger-precopy-{knex,anyapi}.log`. This focused selection covers
formatter, logger, cleanup, early-write and HTTP diagnostic behavior; it does
not replace the preceding full gate or establish native database coverage.
The broader diagnostic acceptance remains open. **116/214 complete; 98 open.**

## 2026-09-11: Accumulated diagnostic gate passed; HTTP fix applied

The Node 24 accumulated gate completed with exit zero (session 99562,
`/tmp/library-diagnostic-accumulated-gate.log`). All 294 files matched
`/tmp/library-field-redaction-source.json` before subsequent source edits.
Results: ordinary **5,383 passes / one existing skip**, canonical **5,447 passes**,
Express 4 ordinary **391** and canonical **393** passes: **11,614 passes total**,
zero failures/cancellations. Types, both query-budget stages, lint and docs pass.
This validates the accumulated formatter bounds, structured write redaction,
include-log changes and route-template diagnostics, plus the contributor docs.
It is not a native database or consumer gate.

After that checkpoint, the reviewed four-file HTTP/early-write redaction draft
was applied. Both maintained regression files now contain the new cases;
connector cases retain the existing Express 4 selection prefix. Scoped lint
passes. Applied-source ordinary logger/cleanup/HTTP checks pass **252/252** (session
89973, `/tmp/library-http-redaction-applied.log`). Canonical Express 4 diagnostic
checks pass **2/2** (session 43094, `/tmp/library-http-redaction-express4.log`).
The direct canonical repeat passes **252/252**; the applied checks total
**506 passes**, zero failures/cancellations/skips. Type checking, scoped lint,
whitespace and docs all pass. Logs: `/tmp/library-http-redaction-applied-anyapi.log`,
`/tmp/library-http-redaction-types.log`, `/tmp/library-http-redaction-docs.log`.
The applied 294-file checkpoint is `/tmp/library-http-redaction-source.json`.
The broader pre-route, related-resource and direct/upstream diagnostic gaps
remain open. Checklist: **116/214 complete; 98 open**.

## 2026-09-11: HTTP diagnostic policy gap reproduced; isolated draft

A real Express/Fastify probe throws a nested error carrying a compiled hidden
field during POST. Both connector events expose the synthetic hidden value on
the current source, despite the write-method event applying redaction. The two
regressions fail at the secret-absence assertion, after receiving HTTP 500.
Baseline: `/tmp/library-http-redaction-before.log`.

An isolated four-file draft moves compiled field selection into the existing
enhanced logger and supplies current route-resource metadata from both connector
error handlers. It also prepares early write metadata assignment, which still
needs its own regression before application. Draft runtime is loaded only into
the probe process using a temporary Node import hook; installed dependencies and
the working runtime are unchanged. The HTTP cases pass **2 ordinary + 2 canonical
= 4**, zero failures/cancellations/skips, including empty persisted storage.
Files: `/tmp/library-http-redaction-draft.patch`, the corresponding draft directory,
`/tmp/library-http-redaction-draft.test.mjs`, and
`/tmp/library-http-redaction-draft{,-anyapi}.log`.

The early-write assignment now has a separate reproducer: an invalid array
input contains protected fields and fails before transaction setup. Its sentinel
leaks on the current source, then disappears with the isolated draft. Both the
existing write case and new malformed-input case pass with original input and
empty storage asserted. Logs: `/tmp/library-early-redaction-{before,draft}.log`.
The broader canonical-environment draft selection completed under session 79584:
**252 passes, zero failures/cancellations/skips**, covering formatter, enhanced
logger, cleanup, HTTP parity, route metadata and both new regression probes.
Log: `/tmp/library-http-redaction-selected-draft.log`. Some pure/fixed fixtures
do not select storage; this is not a native database matrix.

Do not treat this as an applied fix or complete diagnostic acceptance. The
accumulated full gate (session 99562) has passed its ordinary invocation:
**5,383 passes, zero failures/cancellations, one existing skip**. Canonical tests
are running. All 294 implementation checkpoint hashes remain unchanged.
Checklist remains **116/214 complete; 98 open**.

## 2026-09-11: Contributor testing guidance reconciled

**116/214 complete; 98 open. A93/138, B21/48, M2/14, C0/14.** A10-05
is complete. `tests/README.md` replaces stale removed-option examples with the
selected `format`/`returning` contract and describes shared fixtures, Node 24,
types, query budgets, full SQLite/Express verification and separate native
SQL/Redis jobs. The previous development guide now links to this reference;
root README and repository instructions are updated consistently.

Every local link in the two testing guides resolves, and documented npm script
names exist in package.json. `git diff --check` passes. `npm run docs` completed
with exit zero (`/tmp/library-contributor-docs.log`). No runtime, test or package
source changed: all 294 hashes in `/tmp/library-field-redaction-source.json`
match. Broader API documentation, package artifacts and migration acceptance
remain open; this does not close A10-01/02/04 or consumer work.

The accumulated Node 24 `npm run verify` is running under session 99562, log
`/tmp/library-diagnostic-accumulated-gate.log`. Types and both query-budget stages
passed; the complete test invocations must finish before reporting gate results.
The earlier field-redaction docs build also completed successfully (session
61321, `/tmp/library-field-redaction-docs.log`).

## 2026-09-11: Write diagnostics use compiled field visibility

**115/214 complete; 99 open.** The shared serializer accepts structured-field
redaction, applied before value access. Validation records for a protected field
retain field/rule metadata and a redacted message; summaries receive the same
policy. The write-error logger derives its policy from compiled hidden and
normally-hidden output fields. Enhanced logger options snapshot the field list.

Two unit baseline regressions failed (23 earlier logger/cleanup cases passed).
Applied checks also cover a real shared resource with compiled hidden fields,
write failure, rollback, original input and captured diagnostics. The full
selected formatter/logger/write/HTTP group passes **249 per storage environment,
498 total**, zero failures/cancellations/skips. Types, scoped lint and whitespace
checks pass. Logs use `/tmp/library-field-redaction-{before,unit,knex,anyapi}.log`.

The new conformance fixture accepts optional logging settings through its
existing configuration factory. No consumer/dependency change occurred.
A9-08 remains open for connector policy propagation, early metadata ownership,
other resources/direct loggers, uploads and broader redaction coverage. This is
not arbitrary free-text secret scanning.

## 2026-09-11: Enhanced log events share bounded serialization

**115/214 complete; 99 open.** Factored the existing serializer within its module
and reused it for complete enhanced-log argument lists. Messages and additional
data share a preview budget. Only the first 50 supplied arguments are formatted.
Removed the duplicate validation-detail event; the main event contains the
structured error/violation preview. Updated the earlier ownership regression
for this intentional single-event policy while retaining its receiver and result
checks.

Two new baseline cases failed (three earlier logger cases passed). The applied
formatter/logger/error/HTTP selection passes **246 per storage environment,
492 total**, zero failures/cancellations/skips. Types, scoped lint and whitespace
checks pass. Logs use `/tmp/library-event-bounds-{before,unit,knex,anyapi}.log`.
No new serialization algorithm or dependency was added. Direct/upstream logging
and sensitive-field redaction remain outside this acceptance; A9-08 stays open.

## 2026-09-11: Error summaries reuse bounded formatting

**115/214 complete; 99 open.** Closed the unbounded summary path by projecting
its existing message/code/violation/field inputs through the bounded formatter,
then limiting the joined result to 2,048 characters including markers. Short
summary spelling is unchanged. Custom JSON conversion and unrelated detail
getters are not invoked. The original error and arrays remain unchanged.

Two baseline regressions failed (nine existing formatter checks passed).
The applied formatter/logger/error/HTTP selection passes **244 per storage
environment, 488 total**, zero failures/cancellations/skips. Scoped lint and
whitespace checks pass. Logs use `/tmp/library-summary-bounds-{before,knex,anyapi}.log`.
This covers summaries and summary-only enhanced logging, not extra log arguments
or direct/upstream output. A9-08 remains open for those paths and redaction.

## 2026-09-11: Formatted errors have traversal and text budgets

**115/214 complete; 99 open.** Added bounded previews to the existing error
formatter: per-container entries, shared traversal, individual strings and total
copied text. Truncation is explicit and original errors remain unchanged. Large
arrays stop before reading their tail. Non-object custom JSON output and
nonstandard text/value types receive bounded diagnostic representations.

The first three new regressions failed before application (four existing cause
tests passed). Five new cases now cover long/wide payloads, large keys/aggregates,
array-tail reads, custom JSON/nonstandard text and shared sibling traversal.
The applied formatter/logger/error-cleanup/HTTP selection passes **242 per
storage environment, 484 total**, zero failures/cancellations/skips. Scoped lint
passes after removing an extra blank line in the fixture. Logs use
`/tmp/library-error-bounds-{before,unit,knex,anyapi}.log`.

This does not claim bounded output for summaries, extra logger arguments or
upstream/direct calls. A9-08 remains open for those paths and sensitive-field
redaction. The previous full gate predates this formatter change.

## 2026-09-11: Connector diagnostic paths are route templates

**115/214 complete; 99 open.** Two captured HTTP regressions reproduced raw
request URLs in Express/Fastify error metadata. Diagnostics now use Express's
matched route or Fastify's registered handler path and omit the raw URL field.
The tests still receive 404, verify the method/template, and reject concrete IDs
and query values in path metadata. They do not assert that every nested error
field is redacted. The shared connector fixture accepts optional logger settings.

Applied diagnostic/parity checks pass **184 per storage environment, 368 total**.
Express 4's new route case passes once per mode, **370 checks total**, with no
failures/cancellations/skips. Scoped lint and whitespace checks pass. The new
suite is retained in connector scripts and in the Express 4 selection. Package
changes affect those scripts only; dependency declarations and lock are unchanged.
Logs use `/tmp/library-http-log-route-*`. The earlier full gate predates this
change; wider diagnostic context/redaction/bounding remains open.

## 2026-09-11: Include diagnostics use counts

**115/214 complete; 99 open.** Applied the seven-site include-log draft after
the accumulated full gate passed. ID lists now become counts, and full
relationship/include definitions and selection lists are omitted. A parser
comparison strips the same 26 logging statements and finds identical remaining
ASTs, confirming no non-logging code change in the draft.

The applied include-limit/nested-include/adapter selection passes **82 per
storage environment, 164 total**, zero failures/cancellations/skips. Legacy
nested/adapter suites use SQLite; this is not native coverage. Scoped lint passes.
The earlier 11,584-pass full gate predates this log-only follow-up. Evidence uses
`/tmp/library-include-log-{knex,anyapi}.log` and
`/tmp/library-include-log-ast-audit.{mjs,log}`. Broader diagnostic items stay open.

## 2026-09-11: Pending upstream automatic-payload fix

**115/214 complete; 99 open.** Prepared a separate three-line upstream patch
removing parameter/option dumps from automatic method/plugin logs. Six public
regressions fail on the installed dependency and pass on the payload-only draft;
the same six pass when composed with the prior thrown-value draft. Both pretty
and JSON output retain operation messages, and handlers receive full parameters.
The [pending artifact](pending-hooked-api/README.md#separate-pending-diagnostic-payload-patch)
includes source/test hashes and execution instructions. No installed dependency,
manifest/lock or sibling repository changed. Both patch files apply in sequence to a clean isolated copy and match the
composed manifest hash. Its upstream full suite passes **295/295** when run
alone. The first run alongside library tests failed three wall-clock assertions
(five reported failures including their parents); thresholds and implementation
were unchanged for the successful isolated rerun. The exact applied copy also
passes the six payload tests and **12 library integration checks per storage
mode**. Logs use `/tmp/library-upstream-payload-full{,-isolated}.log`,
`/tmp/library-upstream-payload-applied.log` and
`/tmp/library-upstream-payload-library-{knex,anyapi}.log`. Release and dependency
integration remain pending.

The accumulated library full gate passed on the unchanged 292-file
runtime/test checkpoint (11,584 test passes, types, budgets, lint and docs). The pending regression is outside the normal suite and
intentionally fails when run directly against the installed dependency.

## 2026-09-11: Direct operation logs omit raw payloads

**115/214 complete; 99 open.** Removed query parameters, POST bodies, PATCH
attributes and stored filter objects from ordinary storage log messages. Removed
stored upload URLs and subscription filters from their completion messages.
Operation/table/field/subscription identifiers remain. These are log-argument
edits; storage, upload tracking and subscription return values are unchanged.

The applied filter-diagnostic/file-metadata/real Socket.IO selection passes
**77 ordinary + 80 canonical = 157 tests**, zero failures/cancellations/skips.
Scoped lint and whitespace checks pass. Logs use
`/tmp/library-payload-logs-{knex,anyapi}.log`. The inventory records remaining
error payloads, upstream logs and paused positioning work; comprehensive
redaction and bounding are not claimed.

The full Node 24 verification gate passed: **5,369 ordinary + 5,433 canonical
+ 390/392 Express 4 = 11,584 tests**, zero failures/cancellations and one existing
skip. Types, both query budgets, lint and docs passed. All 292 hashes match
`/tmp/library-diagnostics-source.json`; the terminal log is
`/tmp/library-diagnostics-gate.log`.

A read-only dependency probe also confirms pre-handler parameter logging in both
pretty and JSON modes, retaining a synthetic sentinel and 100,000-character value.
The [diagnostic inventory](diagnostic-boundaries.md#upstream-parameter-output-probe)
records the exact capture measurements and the different custom-sink formats.
This is evidence of remaining work, not a claim that library trace edits provide
complete redaction or bounding.

The expanded parser inventory records 161 explicit logging calls, 102 with data
arguments and 52 with interpolated messages (overlapping counts). Review found
additional include ID arrays/configurations, connector URLs, registry contexts
and direct socket error logs. The diagnostic inventory records these owners and
limits of static coverage. Runtime source hashes still match the running gate.

## 2026-09-11: Shared filter traces omit values

**115/214 complete; 99 open.** The diagnostic boundary audit identified direct
payload logs outside enhanced logging and upstream parameter logging before
library methods execute. See the [owner inventory](diagnostic-boundaries.md).
The shared basic-filter traces now omit filter objects, values and field
definitions, retaining operation metadata. A real hidden-field regression failed
before application because its value appeared in captured traces.

The corrected applied selection passes five tests per storage mode (10 total),
including explicit custom-filter translation. The new test checks retained SQL
bindings and actual rows as well as omitted value/schema-default text. Its first
canonical run failed because the test omitted the production table alias; the
fixture was corrected. Scoped lint passes. A9-07/A9-08 remain open, including
other library call sites, payload bounds and upstream coverage. No consumer,
positioning or dependency implementation changed.

## 2026-09-11: Diagnostic causes survive formatting

**115/214 complete; 99 open.** Four regressions reproduced lost native causes,
aggregate members and nested error messages. The existing formatter now includes
non-enumerable native cause/member properties and preserves nested error names,
messages and optional stacks. Primitive causes, cyclic errors and depth limits
are tested. Error objects remain unmodified; HTTP mapping is unchanged.

The applied formatter/logger/error-cleanup/HTTP selection passes **235 checks
per storage environment, 470 total**, with zero failures/cancellations/skips.
Utility checks are included in that count and do not represent separate database
scenarios. Scoped lint and whitespace checks pass. Before application the four
new cases all failed. Logs use `/tmp/library-error-causes-{before,knex,anyapi}.log`.
The checkpoint is `/tmp/library-error-causes-source.json` (291 files).
A9-07 still requires consistent diagnostic fields; A9-08 still requires payload
redaction and size bounds. Depth limiting alone does not satisfy that item.

## 2026-09-11: In-place logger enhancement avoids recursion

**115/214 complete; 99 open.** Diagnostic-source review found that
`enhanceLogger` replaced the base methods, then wrappers dynamically invoked
those replacements, recursively. Three public utility regressions failed with
stack overflows before application. Each wrapper now captures and binds the
original writer before installation, including the supplemental validation log.
Receiver identity, return values, utility logging, formatted validation details
and propagation of the original writer exception are asserted.

The new three cases pass. The applied selection of enhanced logging, error
context, write cleanup and real HTTP connector parity passes **231 per storage
environment, 462 total**, with no failures/cancellations/skips. Several cases are
pure utilities, so this is not 462 distinct database scenarios. Types and scoped
lint pass. Logs are `/tmp/library-logger-ownership-before.log` (0 pass/3 fail) and
`/tmp/library-logger-ownership-{knex,anyapi}.log` (applied). Redaction, bounded
payloads and broader diagnostic requirements remain open; this does not close
A9-07/A9-08 or the separate upstream logging-failure issue.

## 2026-09-11: Negative type-contract acceptance

**115/214 complete (53.7%); 99 open.** A9-06 is complete. Read-helper signatures
now distinguish single/batch minimal reads and full documents, including the
canonical null result. Both plugins annotate the existing helper assignments;
no executable read logic changed. Checked bodies remain a separate requirement.

The nine type fixtures contain 56 negative sites. An in-memory compiler-host
audit removing only expectation comments produced exactly 56 intended diagnostics
at those sites, none missing and none elsewhere. Initial output included
incidental implicit-any diagnostics in two invalid `.map` callbacks; those
callbacks now return constants, isolating the intended result-shape failures.
Every diagnostic was reviewed. Normal strict types and scoped lint pass.
Audit artifacts are `/tmp/library-negative-types-audit.mjs`, `.json` and `.log`.
These are local evidence, not shipped tooling or a replacement type-check command.

The preceding 11,568-pass runtime gate remains the last full gate. This later
work is declarations, type fixtures and documentation; it does not claim a new
runtime matrix. Broader A6-02/A9 coverage and paused consumers remain open.
See [acceptance scope](typechecking.md#negative-contract-acceptance-a9-06).

## 2026-09-11: Declared write-helper inputs and results

**114/214 complete; 100 open.** Inventoried and annotated the five installed
write/existence helpers in both plugins. The declarations retain ordinary
void/success-object results and canonical affected counts, require the explicit
PUT branch and keep unvalidated POST insert results unknown. Core ignores the
non-POST write results. Setter-transformed attributes remain unknown-valued.

Strict type fixtures and scoped lint pass after fixing an unused expression in
a negative type fixture. Documentation builds successfully. This is declaration
coverage, not checked implementation bodies; A6-02 remains open for that work,
read-helper overloads and broader lifecycle coverage. No executable write logic
changed. The existing full gate is not relabelled as verification of this later
annotation checkpoint. See the [contract inventory](storage-boundaries.md#write-helper-signatures).

## 2026-09-11: Checked filtering lifecycle boundary

**114/214 complete; 100 open.** Added strict JSDoc checking to the existing
query-builder utilities and permission-checking `apply-query-filters` method.
`QueryFilteringState` describes native builders, filters, metadata, adapters and
borrowed DB handles. The entry contract requires a builder while hooks may clear
or replace it. The async return remains wrapped to avoid executing a thenable.
Unknown hook unwrapping does not claim to validate the resulting value.

Strict types and negative contract fixtures pass. The seven existing runtime
context tests pass, covering replacements, clearing, nested/synchronous errors,
permission failures and restoration without executing a builder. Scoped lint
passes. A6-02 remains open for data-helper and broader lifecycle typing. The
11,568-pass full gate below predates these annotations and the absent-purpose
empty-string membership fallback; it is not claimed as a new full gate.

## 2026-09-11: Include configuration validates the compiled candidate

**114/214 complete; 100 open.** Seven public baseline regressions reproduce split
validation errors: higher resource overrides were rejected, enriched limits above
lower resource maxima were accepted, and invalid numeric/sort declarations passed
registration. One validator now reads compiled relationships in `schema:compiled`;
the duplicate authored-options loop is removed. Explicit resource maxima take
precedence during compilation. Query-time target caps and capability checks remain
unchanged, including support for forward resource references.

Selected checks pass **154 ordinary-environment + 176 canonical-environment =
330 SQLite checks**, zero failures/cancellations/skips, across include
configuration/limits, legacy query limits, enrichment and plugin registries. The
legacy query-limit suite uses fixed SQLite and includes explicitly ordinary
storage setup, so the environment labels are not uniform backend coverage for
that file. New tests preserve supported zero/null/false limits and verify rejected
canonical candidates retain their owner, descriptor and existing data.

PostgreSQL and MySQL each pass **124 ordinary + 144 canonical = 268 checks**,
**536 native checks total**, zero failures/cancellations/skips, across include
configuration, real include/connector behavior and enrichment. Both runners exited
successfully. Types, scoped lint and whitespace checks pass.

The 286-file checkpoint `/tmp/library-include-config-source.json` changes three
runtime files and adds one conformance file from the prior checkpoint. Logs use
`/tmp/library-include-config-*`. The accumulated full Node 24 gate completed successfully:
**5,361 ordinary + 5,425 canonical + 390/392 Express 4 = 11,568 passes**,
zero failures/cancellations and one existing skip. Types, both query budgets,
lint and docs also passed. All 286 checkpoint hashes match. The terminal log is
`/tmp/library-compiled-plugin-gate.log`. See the
[migration note](../GUIDE/MIGRATING_API_V2.md#include-configuration-is-validated-before-publication).
Positioning initialization remains under the metadata audit; no consumer repository
has been changed.

## 2026-09-11: Autofilter metadata publishes atomically

**114/214 complete; 100 open.** Two canonical regressions reproduced stale
metadata: alias replacement left writes stamping the old relationship (request
validation failed), and removing an autofilter field allowed an invalid candidate
to commit. The compiler now invokes `schema:compiled` before its existing owned
publication snapshot. Autofilter derives metadata on that candidate; all readers
use `schemaInfo.autofilter`. The separate scope-variable copy and authored-schema
fallback are removed. Invalid candidate metadata rejects before publication.

Applied checks pass **85 ordinary + 110 canonical = 195 SQLite checks**, zero
failures/cancellations/skips, across plugin registries, enrichment, configuration
lifetime, file metadata and autofilter behavior. Publication checks retain field
identity across the snapshot and prevent retained candidate mutation from changing
published filters. Invalid additions retain the prior owner and persisted fields.
Types, both query-budget modes and scoped lint passed.

Each native job passes **72 ordinary-environment + 93 canonical-environment =
165 checks**. Of these, 11 per mode come from the legacy autofilter suite, which
creates SQLite directly. Excluding those, PostgreSQL passes **61 + 82 = 143 native
checks**, and MySQL the same: **286 native checks total**, plus **44 extra SQLite
checks**. All pass without failures/cancellations/skips. Both runners completed.
No additional full-library gate is claimed at this checkpoint.

Source checkpoint `/tmp/library-autofilter-owner-source.json` records 285 files;
only the compiler, autofilter plugin and registry conformance suite changed from
the prior checkpoint. Logs use `/tmp/library-autofilter-owner-*`. The
[hook/API migration](../GUIDE/MIGRATING_API_V2.md#new-compiler-hook-schemacompiled)
is recorded separately from the
[metadata ownership fix](compiled-resources.md#autofilter-metadata-publishes-with-the-compiled-owner).
Positioning and include-limit initialization remain under A5-02 review. No
consumer repository changed.

## 2026-09-11: File handling follows compiled metadata

**114/214 complete; 100 open.** The public retained-input regressions reproduced
four failures before the fix: backend identity, post-registration MIME mutation,
schema-enriched MIME rules and late file-plugin installation. File handling now
reads compiled stored fields and keys its existing field cache by the compiled
owner. This removes raw-option discovery and its registration hook; supported
owner replacement refreshes both empty and populated lists.

Declaration snapshots retain file storage handles exposing `upload()`, preserving
backend state and method receivers, while still copying MIME rules and ordinary
column mapping objects. Tests also cover committed additions, unchanged rules
after rejection, an initially empty cache and the backend/mapping distinction.

Final SQLite checks pass **65 ordinary-environment + 69 canonical-environment =
134 checks** across file metadata, file handling, multipart parsing/detection and
configuration lifetime, plus **101 + 101 = 202 file-failure checks**: **336 total**,
zero failures/cancellations/skips. Legacy file-handling and multipart-upload suites
use fixed SQLite fixtures and are not part of the native jobs. Direct snapshot
tests are database-independent.

Final native file-metadata checks pass **4 ordinary + 7 canonical per database =
22 checks**. Native file-failure checks pass **105 + 105 PostgreSQL** and
**101 + 101 MySQL = 412 checks**, giving **434 final native checks total**, zero
failures/cancellations/skips. These cover uploads, failures, rollback and cleanup;
PostgreSQL-specific failure cases account for the count difference. Earlier native
metadata/lifetime selection passed 56 checks before narrowing backend detection;
those are separate historical evidence, not included in the final total.
All native runners exited successfully. Types, scoped lint and whitespace checks
passed. Logs use `/tmp/library-file-metadata-*`.

The source checkpoint `/tmp/library-file-metadata-source.json` records 285 files:
two runtime modules, the shared fixture, one existing lifetime suite and the new
file-metadata suite changed from the previous checkpoint. The
[migration guide](../GUIDE/MIGRATING_API_V2.md#file-upload-rules-follow-compiled-resource-configuration)
and [ownership record](compiled-resources.md#file-metadata-authority-and-backend-ownership)
explain backend identity and configuration lifetime. This extends file coverage
without closing broader A5-02 or the remaining plugin audit. Consumer repositories
and their parked patch are unchanged.

## 2026-09-11: Metadata authority audit finds remaining plugin work

**114/214 complete; 100 open.** A broader read-only source audit identified raw
schema consumption in file handling and positioning registration, an autofilter
fallback, and post-compilation include-limit checks against authored options.
Compiler/enrichment inputs were separated from these later consumers.

The file probe reproduces disagreement between retained MIME rules and compiled
metadata in both SQLite storage modes, and shows plain-object storage backend
identity is not retained by compilation. It uses private access to the retained
declaration, so the next step is a permanent public retained-input regression,
then a fix preserving backend identity while consuming compiled rules. No runtime
source changed in this audit, and no broad checklist item was closed.
See the [remaining boundary inventory](compiled-resources.md#metadata-authority-audit-remaining-plugin-boundaries)
for exact evidence, limitations and follow-up scope. Consumer repositories remain
unchanged.

## 2026-09-11: Request contracts reuse compiled relationships

**114/214 complete; 100 open.** Request-contract construction now reuses compiled
foreign-key membership and relationship definitions. It no longer rebuilds the
polymorphic exclusion set or separately scans stored aliases and declared
relationships to build the same linkage validator. Belongs-to allowed target
types now follow the same precedence as relationship execution. Contract cache
ownership and replacement rules are unchanged.

Selected normal-import checks passed **197 ordinary-environment + 221
canonical-environment = 418 SQLite checks**, plus **one new target-precedence
check in each mode**, all with zero failures/cancellations/skips. Selection covers
metadata caching, enrichment, output indexes, field names, relationship metadata,
Fastify schemas and two legacy polymorphic suites. Those legacy suites use fixed
SQLite fixtures; registry-retention cases force canonical storage in both jobs.
The additional precedence case uses a synthetic variant of compiled metadata.

PostgreSQL and MySQL each pass **88 ordinary-environment + 107
canonical-environment = 195 checks**, **390 native checks total**, zero failures,
cancellations or skips, across metadata cache, enrichment and relationship
metadata. Registry-retention cases again force canonical storage, and direct
contract checks are not themselves database-dependent. Both runners exited
successfully. Types, scoped lint and whitespace checks passed.

The 284-file checkpoint `/tmp/library-request-index-source.json` changes only
`request-contracts.js` and the metadata-cache conformance suite from the previous
checkpoint. Logs use `/tmp/library-request-index-*`. The prior 11,519-pass full
gate remains historical, not a new full verification claim for this follow-up.
See the [design](compiled-resources.md#request-contracts-consume-the-compiled-indexes)
and [migration note](../GUIDE/MIGRATING_API_V2.md#request-contracts-reuse-compiled-relationship-metadata).
Broader A5 requirements remain open; no consumer repository changed.

## 2026-09-11: Shared lookup uses compiled relationships

**114/214 complete; 100 open.** The shared relationship lookup now uses an own
entry from `outputRelationships`, removing per-lookup stored-field scans. The
compiler rejects misplaced stored polymorphic declarations after enrichment and
indexes only ordinary belongs-to aliases from stored fields. The two misplaced
registration regressions failed before the change; both storage modes reproduced
lookup/output disagreement and missing foreign-key membership.

Applied normal-import verification passes **433 ordinary + 457 canonical = 890
SQLite checks**, zero failures/cancellations/skips, across enrichment, output
indexes, related/include permissions, field names, relationship metadata and
include errors. Native verification passes **159 ordinary + 183 canonical = 342
checks per database**, **684 PostgreSQL/MySQL checks total**, zero failures,
cancellations or skips, across enrichment, output indexes and related permissions.
Both native runners exited successfully. Types, both query-budget modes, scoped
lint and whitespace checks passed. The prior complete Node 24 gate passed
**11,519 checks** before this follow-up; no new full-gate result is claimed here.

Tests check lookup definition identity and absence of source scans, unknown and
prototype names, valid metadata replacement, and retained schema/descriptor/data
after failed additions. The 284-file source checkpoint
`/tmp/library-relationship-index-source.json` differs from the prior full gate in
two runtime modules and two conformance files only. Logs use
`/tmp/library-relationship-index-*`. The isolated applied-source probe records
10,000 field-map scans before versus zero after; see
[measurements](query-measurements.md#compiled-relationship-lookup).
The [migration note](../GUIDE/MIGRATING_API_V2.md#compiled-relationship-lookup-and-polymorphic-declaration-location)
covers synthetic helper callers and polymorphic declaration placement. Broader
A5 metadata and consumer migration items remain open. Consumer repositories and
their parked patch are unchanged.

## 2026-09-11: Derived attributes cannot own relationships

**114/214 complete; 100 open.** Computed and projected attribute definitions now
reject `belongsTo` and `belongsToPolymorphic` after enrichment. The output
relationship index is built from stored definitions and declared relationships.
This resolves the reproduced mismatch between lookup and output target resources.
Eight public registration regressions failed with missing rejections before the
change. A canonical addition test verifies retained published owner and valid
existing plain relationship data after rejection.

Selected SQLite checks pass **109 ordinary + 132 canonical = 241 checks**, zero
failures/cancellations/skips, across enrichment, output indexes, linkage/projection
coverage and all four positioning suites. The shared positioning fixture's two
redundant relationship declarations were removed following the prior full-gate
failure; no positioning runtime code changed. Scoped lint and whitespace checks
pass. PostgreSQL and MySQL each pass **59 ordinary + 82 canonical = 141 checks**,
**282 native checks total**, zero failures/cancellations/skips, across enrichment,
output indexes and the main positioning suite. Both runners exited successfully.
The corrected full Node 24 gate completed successfully in
`/tmp/library-derived-relationship-gate.log`: **5,340 ordinary + 5,397 canonical +
390/392 Express 4 = 11,519 passing checks**, zero failures/cancellations and one
existing ordinary skip. Types, both query-budget modes, lint and docs passed.
This gate verifies the source before the compiled-relationship lookup follow-up.
Source checkpoint `/tmp/library-derived-relationship-source.json` contains 284
files, changing only the compiler, two conformance files and the shared fixture
from the alias checkpoint. Logs use `/tmp/library-derived-relationship-*`.
See the [migration guide](../GUIDE/MIGRATING_API_V2.md#derived-attributes-cannot-declare-relationships).
Broader A5 work remains open; no consumer repositories changed.
A subsequent isolated relationship-lookup draft passes **594 SQLite checks** and
removes repeated field-map scanning in a structural probe; it is not applied.
The [draft record](compiled-resources.md#draft-reuse-the-relationship-index-for-lookup)
identifies the remaining acceptance work. A subsequent accepted-shape probe finds
misplaced stored polymorphic declarations; a combined rejection/lookup draft
passes another **179 targeted SQLite checks**. It remains unapplied; see the
[draft prerequisite](compiled-resources.md#draft-prerequisite-polymorphic-declarations-belong-in-relationships). All 284 full-gate source hashes still
match the checkpoint.

## 2026-09-11: Reject ambiguous relationship aliases

**114/214 complete; 100 open.** Four baseline regressions showed that registration
accepted two belongs-to fields sharing an alias, or an alias also declared in
`relationships`, both in authored and enriched definitions. Consumers chose
different definitions: request contracts give declared relationships precedence,
plain output gave aliases precedence, and field lookup could choose the first
backing field. The compiler now rejects repeated relationship names during its
existing belongs-to validation pass, before publishing the candidate.

Selected checks passed **160 ordinary + 182 canonical = 342 SQLite checks**,
zero failures/skips, across schema enrichment, output indexes, field names and
relationship metadata. PostgreSQL and MySQL each passed **34 ordinary + 56
canonical = 90 checks**, **180 native checks total**, zero failures/skips,
across schema enrichment and output indexes. Both native runners exited
successfully. A canonical addition regression verifies unchanged published owner,
no new descriptor field and correct existing data/linkage after rejection.
Scoped lint and whitespace checks pass. Baseline failure evidence is
`/tmp/library-relationship-alias-before.log`; selected logs use
`/tmp/library-relationship-alias-*`. The 284-file source checkpoint changes only
the compiler and two conformance files from the prior conversion checkpoint.

The first full Node 24 gate stopped in the ordinary suite: **5,272 passed,
zero test failures, 60 cancelled and one existing skip**. Four suites could not
initialize because the shared positioning fixture duplicated its category and
project relationships. This is an unsuccessful gate, not a passing result.
The redundant fixture declarations have now been removed; positioning runtime
code is unchanged. The derived-field follow-up below also resolves the additional
compiler probe's conflicting lookup/output targets. Broader A5-03/A5-10 remain
open. Consumer repositories remain unchanged.

## 2026-09-11: Remove duplicate polymorphic conversion scan

**114/214 complete; 100 open.** Record conversion now filters ordinary and
polymorphic backing fields using the same compiled foreign-key set. The wrapper
no longer scans all relationship definitions or allocates a polymorphic set for
every record. Validated polymorphic definitions explicitly name their type/ID
fields; no inferred-name compatibility path remains in conversion.

The metadata read retains the existing error boundary. Its tests now inject
failures at the compiled membership read, preserving typed errors, frozen Error
causes and null throws. A real compiled-resource fixture rejects any attempt to
read relationship declarations during direct conversion and checks exact output.

Checks passed **112 ordinary-environment + 114 canonical-environment = 226 SQLite
checks**, zero failures/skips, across output indexes, include error handling,
relationship metadata and two legacy polymorphic suites. The two legacy suites
use fixed SQLite fixtures; the environment labels do not imply that those suites
exercise canonical storage. Native output-index and relationship-metadata checks
passed **39 ordinary + 41 canonical per database = 160 PostgreSQL/MySQL checks**,
zero failures/skips. Both native runners exited successfully. Types, scoped lint
and diff whitespace checks passed. Logs are `/tmp/library-conversion-membership-*`.

The 284-file source checkpoint differs from the preceding foreign-key checkpoint
only in the converter and two tests. The preceding isolated timing remains
historical: it was measured before this final scan removal, and no additional
speedup is claimed. Broader A5 metadata authority and consumer migration remain
open. No consumer repository was changed.

## 2026-09-11: Reuse compiled foreign-key membership

**114/214 complete (53.3%); 100 open.** The dependency compiler already derives
foreign-key membership. Its existing result now publishes `foreignKeyFields`,
reused by identity validation, record conversion, SQL selection and minimal reads.
Consumers that extend the identity set make a local copy; reads do not mutate
compiled membership. Canonical field additions replace the set with the owner.
No additional cache or raw-schema fallback was introduced.

Verification passed **345 ordinary + 345 canonical = 690 SQLite checks** and
**130 ordinary + 128 canonical per database = 516 PostgreSQL/MySQL checks**,
with zero failures/skips. SQLite selection covers output indexes, include errors,
field names, bigint IDs, reference sorting and search authorization. Native
selection covers output indexes, bigint IDs and field names. Both native runners
have finished and no corresponding database runner/server remains active.
Types, scoped lint and both query-budget modes passed. The first PostgreSQL
invocation used an incorrect binary path and failed before testing; the corrected
invocation produced the passing counts above.

The source checkpoint `/tmp/library-foreign-key-index-source.json` records 284
files; compared with the full-gate checkpoint, five runtime files and the output
index conformance suite changed. Logs use `/tmp/library-foreign-key-index-*`.
The isolated conversion benchmark removed 5,000 field-map enumerations over
5,000 records, with median time **14.127ms → 6.748ms**. It still scans polymorphic
relationship metadata; this is not an end-to-end throughput claim. See the
[measurement](query-measurements.md#compiled-foreign-key-membership) and
[migration note](../GUIDE/MIGRATING_API_V2.md#compiled-foreign-key-membership).
Broader A5 metadata work remains open; consumer repositories are unchanged.

## 2026-09-11: Compiled output indexes under full verification

**114/214 complete; 100 open.** Response normalization now uses two derived
indexes on the existing compiled resource: `outputFields` and
`outputRelationships`. Entries retain identity with the stored/computed/projected
and relationship definitions. This removes per-record source-map merging and
relationship-index rebuilding without another schema format, a fallback layer,
or caching records and caller context. See the
[design](compiled-resources.md#compiled-output-lookup-indexes),
[migration note](../GUIDE/MIGRATING_API_V2.md#compiled-output-definition-indexes), and
[measurements](query-measurements.md#compiled-output-definition-lookups).

The isolated functional draft passed three ordinary and four canonical cases.
Applied normal-import verification passed:

- **260 ordinary-environment + 265 canonical-environment = 525 SQLite checks**,
  zero failures/skips, across output indexes, response metadata, structured values,
  field dependencies/names, temporal boundaries and configuration lifetime.
- PostgreSQL **79 ordinary + 82 canonical = 161 checks**, and MySQL the same:
  **322 native checks**, zero failures/skips, across output indexes, response
  metadata and structured values. The selection includes synthetic
  database-independent response-metadata cases. Both runners completed and their
  recorded servers/disposable directories were removed.
- Types and changed-file lint passed. All **284 source hashes** match
  `/tmp/library-output-definitions-source.json`; changes since the preceding
  lifetime checkpoint are the compiler, response normalizer, new output-index
  conformance file and one synthetic response-metadata fixture.

The full Node 24 gate completed successfully in
`/tmp/library-output-definitions-gate.log`: **5,326 ordinary + 5,380 canonical +
390/392 Express 4 = 11,488 passing checks**, zero failures and one existing
ordinary-suite skip. Types, both query-budget modes, lint and documentation build
also passed. This gate precedes the foreign-key reuse follow-up recorded above.
Selected logs are `/tmp/library-output-definitions-{knex,anyapi,types}.log`
and `/tmp/library-output-definitions-native-{pg,mysql2}.log`.

Uninstrumented median normalization times for 5,000 sparse records were
**21.630ms → 1.412ms** for JSON:API and **28.036ms → 1.834ms** for plain helper
calls. Separate instrumentation measured original-source-map enumeration; plain
normalization still traverses its compiled relationship index. The compiler-only
median was **4.504ms → 4.507ms**, within substantial sample variation. These are
isolated measurements, not end-to-end throughput or statistical guarantees.

Remaining metadata derivation includes foreign-key set construction in record
conversion; it has been identified for the next review but is unchanged here.
A5-02/A5-03/A5-12 remain open. Consumer repositories and dependencies are unchanged.

## 2026-09-11: Cache keys and configuration lifetime acceptance

**114/214 complete (53.3%); 100 open. A91/138, B21/48, M2/14, C0/14.**
A5-08 and A5-09 are complete against the
[cache/lifetime acceptance matrix](compiled-resources.md#cache-and-configuration-lifetime-acceptance)
and [public configuration contract](../GUIDE/MIGRATING_API_V2.md#when-configuration-changes-take-effect).
The matrix ties every named category—scope customization, projections, mappings,
tenant descriptors and runtime options—to its owner/key, effective boundary,
refresh rule and conformance evidence. It leaves metadata derivation removal,
value-boundary changes, impossible-schema validation and consumer migration under
their own open requirements.

The final review added public tests showing runtime defaults and hooks take
effect on the next method call without replacing compiled fields; sort eligibility
changes replace request validation while retaining the unchanged storage adapter.
It also exposed and corrected two ownership gaps: authored autofilter presets
were still live after installation, and nested mutable enrichment fields aliased
`originalFields`. Presets now use the existing snapshot helper; attribute, search
and computed working maps are detached before their enrichment hooks.

The preset baseline passed 20 existing cases and failed its new case, returning
`mutated` instead of `installed`. The enrichment baseline failed because the
original field view exposed the replacement serializer. Logs:
`/tmp/library-preset-lifetime-before.log` and
`/tmp/library-enrichment-originals-before.log`.

Applied Node 24 verification:

- **130 ordinary-environment + 151 canonical-environment = 281 SQLite checks**,
  zero failures/skips, across configuration lifetime, plugin registries, metadata
  cache, adapter lookup, schema enrichment and field dependencies. The registry
  retention portion of metadata-cache intentionally uses canonical storage in
  both environments; other shared fixtures use the selected mode.
- PostgreSQL **54 ordinary + 74 canonical = 128 checks** and MySQL the same,
  for **256 native checks**, zero failures/skips, across configuration lifetime,
  plugin registries and schema enrichment. Each selection includes two
  database-independent snapshot-helper tests per mode. Both runners completed
  successfully; recorded servers and disposable directories were removed.
- Types and changed-file lint passed. These initialization/ownership changes do
  not alter SQL generation for unchanged declarations. No new full-gate or query
  budget claim is made; the earlier full checkpoint passed 11,430 tests.
- All **283 source hashes** match `/tmp/library-lifetime-contract-source.json`.
  Only the compiler, autofilter plugin and two conformance files changed since
  the preceding registry checkpoint. Dependency and consumer files are unchanged.

The compiler-only alternating benchmark measured medians of **1.324ms before
and 1.884ms after** the three enrichment-original copies for 101 fields. Its
baseline already includes input/publication snapshots. This is an initialization
cost measurement, not a whole-API startup or request-throughput claim; see the
acceptance document for methodology and limitations.

Logs: `/tmp/library-lifetime-contract-{knex,anyapi,types}.log`,
`/tmp/library-lifetime-contract-native-{pg,mysql2}.log`, and
`/tmp/library-enrichment-copy-benchmark.log`.

## 2026-09-11: Explicit policy and autofilter registry entries

**112/214 complete; 102 open.** Row-policy names, autofilter resolver/preset names
and autofilter schema fields now require own entries. Resolver normalization uses
a null-prototype dictionary so explicitly registered `__proto__` names survive
introspection. Legitimate explicitly registered prototype-like names continue to
work. See [A5-F17](compiled-resources.md#plugin-registry-ownership-and-inherited-names)
and the [migration note](../GUIDE/MIGRATING_API_V2.md#plugin-registries-require-explicit-entries).

The 20-case baseline produced **17 failures and three passes**: 12 invalid
configurations registered, four unknown presets returned the wrong error category,
and one explicit resolver disappeared from introspection. This is not evidence
that inherited row policies bypassed the existing boolean-result guard.
`/tmp/library-plugin-registry-before.log` preserves the failures.

Applied Node 24 verification:

- **148 ordinary + 152 canonical = 300 SQLite checks**, zero failures/skips,
  across the new registry cases, existing autofilter and row-policy suites,
  search authorization, and configuration lifetime.
- PostgreSQL **115 ordinary + 117 canonical = 232 checks**, and MySQL the same:
  **464 native checks**, zero failures/skips, using the shared registry and
  search-authorization suites. Legacy fixed-SQLite plugin suites were excluded
  from native runs. Both native runners completed successfully; recorded servers
  and temporary directories were removed.
- Types and changed-file lint pass. SQL generation is unchanged for valid
  registrations; query budgets and the full gate were not repeated for these
  lookup guards. The last full gate remains the earlier 11,430-pass compiler
  snapshot checkpoint, with later changes separately verified.
- All **283 source hashes** match `/tmp/library-plugin-registry-source.json`.
  Changes since the preceding ownership checkpoint are the two plugin modules,
  shared fixture options and the new registry conformance file. Consumer and
  dependency files remain unchanged.

Logs: `/tmp/library-plugin-registry-{knex,anyapi,types}.log` and
`/tmp/library-plugin-registry-native-{pg,mysql2}.log`.
The valid-name tests change a policy callback's captured application state and
verify a later query denies rows, retaining per-request policy evaluation.
Broader cache/customization lifetime and early-configuration validation items
remain open; no checklist item is closed solely by this bounded correction.

## 2026-09-11: Configuration input ownership verified

**112/214 complete; 102 open.** Canonical registration and later field additions
now retain owned declaration snapshots. Resource initialization also detaches
sort arrays while preserving explicit runtime variable overrides. The
[configuration regressions](../../tests/conformance-configuration-lifetime.test.js)
verify callback behavior before and after subsequent field additions, authored
sort-array isolation, and query behavior after an explicit variable assignment.
See the [ownership design](compiled-resources.md#retained-registration-inputs-and-sort-options)
and [migration guide](../GUIDE/MIGRATING_API_V2.md#schema-compilation-snapshots-declarations).

Before these follow-ups, the compiler snapshot passed the complete Node 24 gate:
**5,298 ordinary SQLite checks + one existing skip; 5,350 canonical SQLite;
Express 4 ordinary/canonical 390/392 = 11,430 passes**, zero failures. Types,
both query budgets, lint and docs also passed. The original native selection
passed **206 checks**. Gate log: `/tmp/library-configuration-snapshot-gate.log`;
source checkpoint: `/tmp/library-configuration-snapshot-source.json`.

After applying the registration/sort follow-ups through normal imports:

- **178 ordinary + 201 canonical = 379 SQLite checks**, zero failures/skips,
  across configuration lifetime, schema enrichment, field dependencies,
  structured values, reference sorting and pagination.
- PostgreSQL **86 ordinary + 106 canonical = 192 checks**; MySQL the same,
  for **384 native checks**, zero failures/skips, across configuration lifetime,
  schema enrichment and reference sorting. Both runners completed successfully;
  their recorded servers and disposable directories were removed. The selection
  includes two database-independent helper tests per mode.
- Types, changed-file lint and both query-budget modes passed.
- All **282 source hashes** match `/tmp/library-configuration-ownership-source.json`.
  Only the canonical plugin, scope-variable initializer and expanded configuration
  test changed since the full gate. The full gate was not repeated for this
  follow-up; its scope and the subsequent selected verification are distinct.

Logs: `/tmp/library-configuration-ownership-{knex,anyapi}.log`,
`/tmp/library-configuration-ownership-native-{pg,mysql2}.log`, and
`/tmp/library-configuration-ownership-{types,budgets}.log`.
The earlier isolated drafts are now applied. Broader plugin-option and structural
customization lifetime requirements remain open under A5-08/A5-09. Consumer
repositories, dependency files and the parked migration patch remain unchanged.

## 2026-09-11: Compilation snapshots under verification

**112/214 complete; 102 open.** The compiler now snapshots declaration input and
published metadata, using a helper in the existing schema-helpers module.
Authored and hook-retained objects no longer change the active compiled storage
configuration. Shared compiled references and callback identities are preserved;
plain declaration data and nested schemas are detached without freezing
application-owned objects. See the [implementation boundary](compiled-resources.md#compilation-snapshot-implementation)
and [migration guidance](../GUIDE/MIGRATING_API_V2.md#schema-compilation-snapshots-declarations).

Selected Node 24 verification passed **101 ordinary + 123 canonical = 224 SQLite
checks**, zero failures/skips, across configuration lifetime, enrichment,
field dependencies and structured values. Types and changed-file lint pass.
PostgreSQL passed **41 ordinary + 62 canonical = 103 checks**, zero failures/skips,
across configuration lifetime, enrichment and structured values. Its runner
completed successfully and the recorded server/directory were removed. The
selection includes two database-independent snapshot-helper tests per mode.
An isolated loader bypassing the compiler snapshots makes both new public
configuration-isolation tests fail; its two helper tests still pass. The first
test draft incorrectly used an asynchronous schema type and then expected a raw
validation result; both test assumptions were corrected before these passing runs.

MySQL also passed **41 ordinary + 62 canonical = 103 checks**, zero failures/skips;
its runner completed successfully and its server/directory were removed. The
native total is **206 checks**. The full gate
(`/tmp/library-configuration-snapshot-gate.log`) remains running at this checkpoint;
its ordinary suite passed **5,298 checks with one existing skip**. No final gate
success is claimed. The PostgreSQL log is
`/tmp/library-configuration-snapshot-native-pg.log`; SQLite logs use
`/tmp/library-configuration-snapshot-{knex,anyapi}.log`. All **282 source hashes**
match `/tmp/library-configuration-snapshot-source.json`. Runtime changes since the
preceding checkpoint are confined to the compiler and schema helpers, with one
new conformance test file. No consumers or dependencies were edited.

A follow-up probe proves that canonical `addKnexFields()` still resamples the
retained authored declaration: the active snapshot keeps the original serializer
until a later field addition, which adopts the externally changed callback.
`/tmp/library-configuration-recompile-probe.log` records that observation.
An unapplied canonical registration/input snapshot draft corrects this isolated
probe (`/tmp/library-configuration-registry-draft.log`). It is staged only in
`/tmp/library-configuration-registry-draft.js`; expanded regression tests are in
`/tmp/library-configuration-registry-test-draft.js`. Neither draft is applied
while the current gate runs. The isolated draft and expanded tests pass **49
canonical SQLite checks**, including source and later field-addition input
mutation, plus existing schema-enrichment cases
(`/tmp/library-configuration-registry-selection-draft.log`). A5-08/A5-09 remain open.

## 2026-09-11: Configuration lifetime mutation probe

**112/214 complete; 102 open.** Four isolated Node 24 SQLite scenarios (two per
actual storage mode) confirm that authored nested storage metadata remains live
after resource registration. Adding a serializer changes writes in both modes,
but ordinary filters retain the old no-serializer branch while canonical filters
use the new serializer. Changing the authored column leaves the cached mapping
unchanged. Scenarios with an existing serializer establish the branch condition.
All four probe scenarios completed successfully and fixtures closed; these are
characterization observations, not passing regression tests for a completed fix.

See [A5-F16 and the reproduction](compiled-resources.md#authored-nested-storage-mutation-configuration-lifetime-evidence).
The existing contract disallows arbitrary metadata mutation. Configuration
finalization remains open; no runtime changes, full-suite rerun, native test run,
or consumer edits were made for this audit.

## 2026-09-11: Read consumers use compiled field maps

**112/214 complete; 102 open.** Four response/include/selection modules now
read `schemaInfo.schemaStructure` directly instead of guessing a wrapper shape
from `schemaInstance`. The unused `getSchemaStructure` helper is removed; the
synthetic error-boundary fixture supplies compiled metadata. The migration guide
explains the internal helper removal and metadata requirement. Runtime field
values and cache/configuration policies are unchanged.

The selected suites pass **384 ordinary-mode + 394 canonical-mode = 778 SQLite
checks**, zero failures/skips. The legacy full-linkage fixture is ordinary in
both runs; shared suites use the selected mode. PostgreSQL passes **138 ordinary +
146 canonical = 284 checks**; MySQL passes the same selection for **568 native
passes total**. Both runners exited zero and removed their servers/directories.
Types, changed-file lint and both query-budget modes pass.
Logs use `/tmp/library-compiled-field-read-`; the 281-file source snapshot uses
that prefix too. Wider A5 requirements remain open, and consumer repositories
remain untouched.

## 2026-09-11: Explicit table schemas applied

**112/214 complete; 102 open.** All five direct table helpers now require an
explicit `structure` field map, with object field definitions. Bare maps and
invalid shapes reject before SQL or generated output. Thirteen actual calls were
ported in the ordinary plugin and two test files; resource-level argument shapes
remain unchanged. The new [migration example](../GUIDE/MIGRATING_API_V2.md#table-helper-schemas-use-an-explicit-structure-wrapper)
and schema reference explain the selected contract.

The normal-import SQLite selection passes **290 + 296 = 586 tests**, zero failures
or skips. Direct table suites exercise ordinary storage in both environment modes;
field-name/namespace suites use the selected storage. Types and changed-file lint
pass. The applied implementation matches the isolated draft that passed
**240 PostgreSQL + 214 MySQL = 454 native checks**; those counts are ordinary
schema-helper checks repeated under each runner mode. Subsequent draft edits
clarified JSDoc and formatted test calls. The new ten-case input suite also passes
on both native databases without the loader: **40 applied native checks**. Both
runners exited zero and removed their servers/directories.

The source checkpoint is `/tmp/library-table-schema-source.json` (281 files).
Logs use `/tmp/library-table-schema-applied-`. The preceding full 11,402-pass gate
verifies the corrected foreign-key caller and earlier changes; it predates this
table-helper contract. No consumer repository changed. Broader A5 metadata and
configuration-lifetime requirements remain open.

## 2026-09-11: Foreign-key caller correction

**112/214 complete; 102 open.** The full gate caught 15 ordinary-response
regressions after the field-map change. An aliased helper import in
`knex-json-api-transformers-querying.js` still supplied a Schema instance; it now
uses `schemaInfo.schemaStructure` and `schemaRelationships`. The import has its
original name again so future inventories see the actual helper call.

The affected selection passes **245 ordinary-mode + 247 canonical-mode tests**.
Its legacy `full-jsonapi-belongsto-linkage` fixture is ordinary storage in both
runs; the other suites use their selected mode. An additional shared end-to-end
case checks GET/query output with a `structure` attribute and belongs-to linkage;
the three focused structure-name checks pass per mode. Changed-file lint passes.
PostgreSQL and MySQL each pass 243 ordinary + 245 canonical = 488 checks
(**976 native passes total**). Both runners exited zero and removed their
servers/directories. The full Node 24 gate exited zero: **5,284 ordinary + 5,336 canonical +
390/392 Express 4 = 11,402 passes**, zero failures and one existing skip. Types,
query budgets, lint and docs pass against `/tmp/library-structure-caller-source.json`; logs use `/tmp/library-structure-caller-`.
The previous full gate's failure is retained rather than presented as successful
verification. Table-helper ambiguity remains a separate open follow-up.

## 2026-09-11: Explicit foreign-key field maps

**112/214 complete; 102 open.** A5 review found a real field-map/wrapper
ambiguity in `getForeignKeyFields`: a legitimate `structure` attribute hid
belongs-to fields, allowing a forbidden identity serializer through compilation.
Both new regressions fail before the fix (empty field set and missing rejection).
The helper now accepts an explicit field map. The initial caller inventory
missed an aliased response-conversion import, corrected as recorded below. The migration guide explains `.structure` for direct Schema callers.

Applied field-name, bigint-ID and callback-dependency suites pass **185 ordinary +
182 canonical = 367 SQLite tests**, zero failures/skips. PostgreSQL passes the
same 367 checks, and MySQL also passes all 367: **734 native passes total**.
Both runners exited zero and removed their servers/directories. Full Node 24
verification against the 280-file `/tmp/library-structure-field-source.json`
checkpoint exited 1: 5,268 passes, 15 failures and one existing skip. The failures
exposed the missed Schema-instance caller and stopped the gate before its
canonical/Express/lint/docs stages. Logs use
`/tmp/library-structure-field-`. The two changed checkpoint files are the helper
and its regression suite. No consumer repository changed.

The follow-up source audit also found dual-shape handling in table-schema
resolution and older response/include helpers. The latter receive schema
instances from compiled resources; table helpers expose both map/wrapper forms
and require a separate caller/contract review. This fix does not close A5's
broader metadata requirements.

## 2026-09-11: Storage duplication acceptance

**112/214 complete; 102 open. A6-15 is complete.** The [acceptance matrix](storage-boundaries.md#remaining-storage-duplication-a6-15-acceptance)
reconciles shared query/context/cache decisions and retained backend write
responsibilities. Ordinary PUT/PATCH no longer call the unused relationship
re-extractor, which consumed obsolete compiled metadata. The core already merges
relationship values and applies setters before storage. The internal module was
removed and the migration guide documents direct-import/storage-extension impact.

Eight shared setter cases per mode pass before removal. Initial fixture failures
were corrected for plain input/output and complete PUT payloads; no runtime setter
defect was established. After removal, five shared suites pass **1,170 ordinary +
1,170 canonical = 2,340 SQLite tests**. Three focused suites pass **120 per mode
per native database = 480 native tests**, zero failures/skips. Both PostgreSQL and
MySQL runners exited zero and removed their servers/directories. Types, both query
budgets and changed-file lint pass; lint fixed only test formatting. Logs use
`/tmp/library-write-preparation-` and `/tmp/library-relationship-setter-`.
The 280-file `/tmp/library-write-preparation-source.json` checkpoint replaces the
deleted module with the new regression suite. The previous full 11,374-pass gate
is historical; the subsequent cache and write changes have their separately
recorded applied checks. Consumer repositories remain untouched.

## 2026-09-11: Shared adapter lookup applied

**111/214 complete; 103 open. A6-15 remains in progress.** Both storage plugins
now use `createStorageAdapterLookup` in the existing storage adapter module.
The resource resolver remains explicit at each call site; scope-name/schema
identity, missing-resource handling and adapter attachment are unchanged.
The helper and minimal resolver/resource types are strictly checked. Four
negative fixtures produce exactly four intended diagnostics when unsuppressed;
the temporary probe was removed. Type checking and changed-file lint pass.

The applied adapter, include-adapter and schema-enrichment selection passes
**40 ordinary + 71 canonical = 111 SQLite tests**. PostgreSQL and MySQL each
pass the same selection: **222 native passes**, zero failures/skips. Both native
runners exited zero and removed their server processes/directories. Both query
budget modes pass. Logs use `/tmp/library-adapter-lookup-`.

The new snapshot `/tmp/library-adapter-lookup-source.json` contains 280 files,
including both new tests and `storage-types.d.ts`, which the preceding source
manifest omitted (the compiler checked it, but that manifest did not hash it).
The previous full gate's 11,374 passes remain the preceding checkpoint; the
full gate was not repeated for this isolated cache extraction. Applied evidence
is the selected SQLite/native suites, types, budgets and lint above. Remaining
write-preparation duplication stays under review. Consumer repositories remain
untouched.

## 2026-09-11: Shared query-filter context lifetime

**111/214 complete; 103 open. A6-15 remains in progress.** Six repeated
save/filter/restore sequences now use `withQueryFilteringContext` in the existing
query-builder utility. Callers retain permission checks, backend filter ordering,
count strategy and adapter ownership. The helper returns a wrapped builder to
avoid premature thenable execution and retains the original builder when a hook
clears temporary state. See the [duplication review](storage-boundaries.md#query-context-duplication-review).

Seven direct checks pass, covering async replacement, nested failures, cleared
state, synchronous failures and include permission/adapter restoration. Four
shared conformance suites pass **137 ordinary + 140 canonical = 277 SQLite
checks**, zero failures/skips. An isolated loader mutation returning the builder directly fails four of the
seven checks with the expected premature-execution assertion; runtime source was
not mutated. PostgreSQL and MySQL each pass all 277 selected checks (**554 native passes**),
and both runners exited zero with their servers and directories removed. The
metadata inventory/source links were corrected to remove stale proxy references.
The full Node 24 gate exited zero: **5,270 ordinary + 5,322 canonical +
390/392 Express 4 = 11,374 passes**, zero failures and one existing skip. Types,
both query budgets, lint and docs pass. All hashes match the 277-file `/tmp/library-filter-context-source.json` checkpoint; logs
use `/tmp/library-filter-context-`. No consumer repository changed. A separate,
unapplied adapter-lookup draft passes four checks with real compiled resources;
its cache identity and isolation behavior is recorded in the duplication review.
It does not change the verified runtime snapshot.

## 2026-09-11: Checked stable-sort contracts

**111/214 complete; 103 open.** Strict checking now covers the existing stable
sort normalization/parser helper. Only JSDoc/comments changed in its runtime
source; the compiler configuration and a compiled-only fixture supply the new
coverage. The type check and changed-file lint pass. Removing four expected-error
directives produced four intended compiler diagnostics; the temporary probe was
removed. Selected sort-field logs report **35 ordinary + 35 canonical passes**,
zero failures or skips, on Node 24. Logs use `/tmp/library-sort-contract-`.
The prior full gate and native runs remain the runtime checkpoint; they were
not repeated for annotations. Broader query and lifecycle typing remains open.

## 2026-09-11: Shared-query acceptance reconciliation

**111/214 complete; 103 open. A6-08 is complete.** The acceptance review maps
both plugins' existing shared selection, membership, sort and pagination calls
to tests for results, links, metadata, permissions and typed errors. The current
source remains identical to the 275-file native-query checkpoint: **11,360 full-
gate passes with one existing skip**, types, query budgets, lint/docs, and
**1,250 native passes**. No runtime implementation or test assertions changed in
this reconciliation. Broader typing, remaining duplication audits and external
query-hook/consumer migration remain open. Documentation was rebuilt after the
review. See [the requirement/evidence matrix](storage-boundaries.md#shared-query-decisions-a6-08-acceptance-review).

## 2026-09-11: Applied native builders and custom-filter helpers

**110/214 complete; 104 open. A6-06 is complete.** Custom filters now receive explicit column/value
translation plus request/resource details as their third argument. The custom
rank and availability fixture callbacks were migrated. A new shared fixture
suite checks local and joined mapped/serialized fields, callback receiver,
context and borrowed transactions. Its initial self-reference fixture used an
unsupported relationship path; the corrected two-resource fixture passes all
four cases per mode. This was a fixture error, not a runtime regression.

After the translated-filter experiment passed all 287 selected tests, the
655-line proxy module was removed. Canonical collection/count helpers now use
native Knex builders through the existing storage adapter, with an optional
alias and qualified tenant/resource predicates. Proxy metadata and alias maps
were removed; no compatibility wrapper replaces them. The migration guide
explains explicit logical-field translation and the removed internal contract.

The initial normal-import selection passed **311 ordinary + 314 canonical =
625 tests**. Strict types pass. A later assertion exercises the new alias option
directly, and the second fixture callback was migrated before starting the full
Node 24 gate. The full gate and native selections completed against the
275-file `/tmp/library-direct-query-source.json` snapshot. PostgreSQL has
completed **311 ordinary + 314 canonical = 625 native passes**; MySQL now
passes the same selection, for **1,250 native passes total** with zero failures
or skips. Both runners exited zero and removed their servers/directories. All
275 snapshot hashes still match. The full gate exited zero: **5,263 ordinary +
5,315 canonical + 390/392 Express 4 = 11,360 passes**, zero failures and one
existing skip. Types, both query budgets, lint and documentation pass. The prior applied
selection is not presented as verification of those later test/fixture edits.
Logs use `/tmp/library-direct-query-` and `/tmp/library-custom-filter-context-`.
A6-09/A6-10 remain open; external query-hook/consumer migration is still paused.

## 2026-09-11: Direct canonical query experiment

**109/214 complete; 105 open.** Inventory found two canonical proxy construction
sites (collection and count helpers). A loader-only experiment supplied the
already-scoped native builder instead of its proxy and passed **285/287 selected
tests**; the two failures identify one custom filter's reliance on implicit
logical-column translation. No runtime change was applied and no checklist item
was closed. This gives A6-09/A6-10 a concrete next dependency to remove without
building more compatibility machinery. The fixture and caller still need an
explicit field-translation contract and wider verification.

The terminal experiment exited 1 as expected from those failures. Its log is
`/tmp/library-direct-query-probe.log`; draft/loader paths use the same prefix.
The existing source snapshot `/tmp/library-scope-audit-source.json` remains the
current runtime/test checkpoint. Consumer repositories remain untouched.

## 2026-09-11: Tenant/resource overlap audit

**109/214 complete; 105 open. A6-11 is complete.** The audit has an owner/assertion matrix for base
queries, compliant hook replacements, joins, nested search, includes, counts,
cursors and transaction/request state. No runtime defect was found in the added
cases, and no runtime change was made for this slice.

`conformance-query-visibility.test.js` now keeps four foreign-scope records with
overlapping IDs present across its collection, related, count, include, cursor
and transaction tests. It passes **18 ordinary + 19 canonical = 37 SQLite** and
**74 native** checks. `conformance-search-authorization.test.js` adds borrowed-
transaction checks for visible foreign groups/teams with overlapping IDs under
both policy and workspace visibility. Direct, nested and polymorphic filters
must reject the foreign labels while retaining legitimate matches and counts.
The full search file passes **95 ordinary + 97 canonical = 192 SQLite** and
**384 native** checks; one collation case intentionally uses ordinary storage in
each runner mode, on the selected database. Changed-file lint passes.

Logs use `/tmp/library-scope-replacement-` and `/tmp/library-scope-search-`.
All four runners exited zero and removed their servers and directories. The
275-file source reconciliation confirms only the two intended test files changed
from the sort checkpoint; no runtime, package or dependency files changed. The
new snapshot is `/tmp/library-scope-audit-source.json`. The established hook contract requires clones to preserve
constraints; arbitrary constraint-removing custom SQL is not a protected query
path. No consumer repository or runtime API was changed.

## 2026-09-11: Shared sort-order and query-object acceptance

**108/214 complete; 106 open. A6-04 is complete.** Its acceptance audit now maps the existing
field-selection, sort, cursor-chain, membership and pagination descriptions to
their shared owners and actual callers. The remaining repeated sort direction /
null-placement choice has a draft helper in the existing sort module; physical
field resolution, relationship visibility and descriptor assembly remain in the
plugins. The applied change touches only that helper and its four ordering call sites.

The draft is held in `/tmp/library-sort-order-draft.json` and supplied through a
Node 24 loader for isolated checks while the preceding full gate's worktree
source remains fixed. Initial pagination/hidden-sort/reference-sort/projection
selection passes 112 tests under each mode setting (224 total). Its legacy
`projected-fields.test.js` uses ordinary SQLite in both invocations; those cases
are not claimed as canonical or native projection evidence. The shared temporal
suite separately passes eight projection/cursor cases per mode (16 total).
A draft mutation disabling backward direction reversal fails both selected
sparse temporal projection cases, demonstrating that their assertions detect the
relevant ordering regression. Neither mutation nor loader is shipped.

The native selection uses only shared-fixture pagination, hidden-sort,
reference-sort and temporal suites. It passed **968 tests** (241 ordinary and
243 canonical on each of PostgreSQL and MySQL) with the exact draft module
sources. Both runners exited zero and removed their servers and directories.
All three draft files pass lint. After the preceding full gate exited zero,
those exact three sources were applied to the worktree. Normal-import SQLite
selections pass **241 ordinary + 242 canonical = 483 tests**. Types and both
query budgets pass. All 275 source hashes reconcile and the three modules exactly
match their native-tested versions. This evidence completes A6-04; broader
A6 storage typing, proxy migration and constraint audits remain open.
The applied source snapshot is `/tmp/library-sort-order-source.json`. Logs use `/tmp/library-sort-order-`. The source snapshot for
the preceding gate remains `/tmp/library-query-constraint-source.json`.

## 2026-09-11: Checked mandatory query membership

**107/214 complete; 107 open.** `query-constraint.js` now checks the existing
symbol-keyed constraint and storage inputs under strict TypeScript. It requires
a resource name, accepts a logical value map and an unexecuted ID subquery, and
leaves ownership and authorization to the callers. Knex's equivalent field/value
map form retains unknown serializer outputs without a false scalar assertion.
No new query abstraction or public API was introduced.

The direct storage suite now exercises combined mapped/serialized values,
false/zero/null, subqueries, existing predicates, cloned counts, empty membership
and ignored resource scopes. The first test draft compared Knex's random query
UID; the corrected assertions compare emitted SQL and bindings. That draft
failure was a test assertion issue, not a runtime defect.

Selected storage/related/related-permission/socket-authorization suites pass
**247 ordinary + 249 canonical = 496 SQLite tests**. Strict types and changed-file
lint pass. Removing the six negative type-fixture directives produces exactly
six intended compiler errors; the temporary probe was removed afterwards.
Native selections pass **992 tests**: 247 ordinary and 249 canonical on each
of PostgreSQL and MySQL. Both runners exited zero, removed their directories
and server processes, and all 275 snapshotted files still match. The full Node
24 gate exited zero: **5,259 ordinary + 5,308 canonical + 390/392 Express 4 =
11,349 passes**, zero failures, one existing skip, with types, both query budgets,
lint and documentation passing. All 275 source hashes matched before applying
the separate sort-order follow-up. Logs and the source
snapshot use `/tmp/library-query-constraint-`. This advances A6-02/A9 without
claiming checked producer lifecycles, the canonical proxy, or the full storage
contract. Consumer repositories remain untouched.

## 2026-09-11: Native SET preflight and capability audit

The final audit also added `tests/anyapi-slot-capacity.test.js`: 18 checks cover
all six slot pools and new registration, replacement, and field allocation.
Exhaustion leaves persisted metadata and cached/fresh descriptors unchanged.
The suite passes 18 SQLite checks and 72 native checks (18 per runner mode per
database), plus lint. Native runners exited zero and removed their servers and
directories. This test-only addition was made after the full gate started and
is recorded separately from that gate’s test counts. Its logs use
`/tmp/library-slot-capacity-`. No runtime change was needed for this slice.

**107/214 complete; 107 open. A6-13 is complete.** Direct table create/add/alter now share an early
native-SET check, replacing the late per-column guard. Unsupported alteration
previously acquired a SQLite lease and ran introspection before rejecting; it
now rejects without SQL. Native SET generation requires an explicit target. The
existing cross-dialect diff warning/omission behavior is retained and tested.

The before-source SET selection passes two create/add controls and fails two
new expectations: missing generation target and early alteration rejection.
Applied schema/preflight/unit suites pass **122/122 per SQLite mode (244 total)**;
changed-file lint passes. Native schema selections pass **414 tests**: PostgreSQL
110 per storage mode and MySQL 97 per mode, with zero failures or skips. Both
runners exited successfully and removed their disposable directories and server
processes. All 273 files in the combined-gate source snapshot still match. The
combined full Node 24 gate exited zero: **5,238 ordinary + 5,287 canonical +
390/392 Express 4 = 11,307 passes**, zero failures and one existing skip. Types,
both query budgets, lint and docs pass. The full-gate source manifest matches
all 273 files; the additional capacity test is separately verified above.
The gate log is `/tmp/library-preflight-complete-gate.log`. Logs use `/tmp/library-set-preflight-` and
`/tmp/library-preflight-complete-`; the source snapshot has 273 files.

The [A6-13 acceptance review](storage-boundaries.md#capability-preflight-acceptance-review-a6-13)
maps all requested capability guards to their tests and limits. It does not
close A6-13 before the current gate finishes or erase A7's dispatcher limitation.

## 2026-09-11: Temporal schema precision preflight

**106/214 complete; 108 open.** Shared table-schema preparation now rejects
malformed time/dateTime precision and unsupported native precision before any SQL.
Runtime helpers use the actual client; migration diffs validate their resolved
dialect, and generic generation above precision 6 requires an explicit target.
The capability description distinguishes native column precision from converter
write precision. The migration guide records the earlier, actionable errors.

The final before-source baseline has **28 failing preflight expectations**,
covering missing generation guards, inconsistent validation/diagnostics and late
DDL validation. Earlier fixture drafts had an incorrect introspection argument
and incomplete table reset; they are not used as defect evidence. The corrected
fixture recreates its schema per case. Two positive zero-precision cases were
then added. Applied capability/schema suites pass **146/146 per SQLite mode
(292 total)**. PostgreSQL passes **158/158 per mode**, MySQL **148/148 per mode**:
**612 native passes**, no skips/failures. The native runners exited zero and
removed their servers/directories. Types and changed-file lint pass.

Assertions require no emitted SQL for invalid runtime declarations, unchanged
schema/rows and no created table; native tests include a misleading supplied
dialect and inspect valid zero-precision columns. Logs and the 273-file source
snapshot use `/tmp/library-schema-precision-`. No new full gate is claimed for
this preflight slice; A6-13's broader audit remains open.

## 2026-09-11: Include capability preflight finding

**106/214 complete; 108 open.** The A6-13 review found that ordinary `dataGet`
omitted `api` when calling `processIncludes`, while `dataQuery` passed it. The
include loader therefore received no window capability for single-record reads
or the full-response GET used by writes. A public draft with window support
disabled reproduced two missing rejections in ordinary GET/PATCH; canonical
GET/PATCH both rejected correctly.

The one-argument fix is now applied. Five retained cases cover GET, collection
query and full PATCH rejection, no executed window SQL, rollback/preserved rows,
and successful none/minimal writes that need no included response. The final
isolated draft passed all five cases in each mode. Applied preflight/include-limit
suites pass **80/80 per SQLite mode (160 total)**. Initial test-formatting lint
errors were fixed; lint and type checking pass. PostgreSQL and MySQL each pass
**80/80 per mode (320 native total)**, no skips/failures. Both runners exited
zero and removed their servers/directories; all 272 source hashes match. Logs and the 272-file snapshot use `/tmp/library-include-capability-`.
The preceding 11,229-pass full gate verifies the capability description checkpoint;
it is not a full run of this later dependency-forwarding fix. A6-13 remains open
for its broader preflight audit.

## 2026-09-11: Relationship and serialization capabilities

**106/214 complete (49.5%); 108 open. A6-12 verified.** Initialized capability metadata now describes
relationship forms/cardinalities and built-in serialization constraints. The
existing cardinality helper, structured-value converter and scalar-query guard
consume the shared definitions. Static feature arrays/maps are frozen. This
preserves resource-specific validation, authorization and custom serializer/filter
responsibilities; it adds no adapter framework or second validation pipeline.

Ten direct relationship cases cover all supported forms, missing/unknown kinds,
prototype-like keys and attribute precedence. The installed fixture verifies the
feature metadata and rejects nested mutation. Capability, structured value/query,
serializer and relationship metadata tests pass **181 ordinary + 184 canonical =
365 SQLite checks**. Type checking passes. PostgreSQL also passes **181 ordinary
+ 184 canonical = 365** checks, exited zero and removed its server/directory.
MySQL also passes **181 + 184 = 365** checks, exited zero and removed its
server/directory. Combined native total: **730 passes**, no skips/failures.
The full Node 24 gate exited zero: **5,199 ordinary passes + one existing
skip; 5,248 canonical; Express 4 390/392**, totaling **11,229 passes**. Types,
both query budgets, lint and docs pass. All 271 source hashes match. The audit
is retained in `/tmp/library-feature-capabilities-audit.json`. Logs and the 271-file snapshot use
`/tmp/library-feature-capabilities-`.

The [A6-12 description review](storage-boundaries.md#capability-description-acceptance-review-a6-12)
reconciles the capability slices and their limits and closes A6-12. A6-13 and
consumer-dependent requirements remain separate.

## 2026-09-11: Temporal conversion capabilities

**105/214 complete; 109 open.** The existing converter now reads its built-in
year/fraction limits from the capability module. Native and text variants are
published at initialization; actual slot mapping still selects the variant for
conversion. This preserves the different native SQL time and text time limits,
MySQL date range and built-in millisecond dateTime conversion.

Twelve descriptor cases cover supported aliases and native/text representations.
Installed capability publication, temporal conformance, boundary and cursor
checks pass **210 ordinary + 211 canonical = 421 SQLite checks**. Types and lint
pass. The first native-launched selection also passed, but included the legacy
`temporal-boundaries.test.js` suite that constructs SQLite directly; those totals
are not claimed as native coverage. Corrected native selections use only
`database-capabilities.test.js` and `conformance-temporal.test.js`, with real-driver
fixtures. Each database passes **179 ordinary + 181 canonical = 360** checks,
for **720 native passes**, no skips/failures. Both corrected runners exited zero
and removed their servers/directories; the initial mixed-scope runners also
cleaned up. All 271 source hashes match. Logs use
`/tmp/library-temporal-capabilities-`. Remaining relationship/serialization capability
requirements stay open. See [temporal scope](storage-boundaries.md#temporal-conversion-capabilities).

## 2026-09-11: Insert result capabilities

**105/214 complete; 109 open.** Insert-result detection and query form now live
in the existing capability module. All three runtime insert sites use its small
helper: ordinary data, canonical data and canonical registry entries. MySQL no
longer requests an ignored RETURNING clause; other clients retain their prior
form. Each caller retains its existing identity conversion and explicit-ID rules.

Seven direct cases check query identity, returned-column arguments and client
modes. The installed fixture checks registry initialization and generated/explicit
resource writes without unsupported-returning warnings. Capability, mapped ID,
wide-ID and registry-failure suites pass **198 ordinary + 194 canonical = 392
SQLite checks**. PostgreSQL passes **201 ordinary + 197 canonical** and MySQL
**198 + 194**: **790 native passes**, no skips/failures. Both runners exited
zero, removed their servers/directories and logged no unsupported-returning
warnings. Types and changed-file lint pass; all 271 source hashes match.
Logs/source snapshot use `/tmp/library-insert-capabilities-`; the snapshot has
271 files. The mutation probe restores the previous unconditional-returning
policy in an isolated loader; both MySQL query-form cases fail (0/2), confirming
the regressions detect a restored unsupported request. A6-12/A6-13 stay
open for the remaining temporal and relationship/serialization requirements.
See [insert result scope](storage-boundaries.md#insert-result-capabilities).

## 2026-09-11: Schema capability ownership

**105/214 complete; 109 open.** The existing capability module now describes
field-alteration ownership, caller prerequisites and native-set support. Both
plugin capability objects publish it; field alteration and set-column validation
consume it. This retains the tested standalone/rebuild/transaction paths rather
than reducing schema ownership to one boolean. Unknown dialects are explicitly
unrecognized; their existing fallback is not presented as verified support.

Seven descriptor cases cover aliases and unknown clients. The installed-plugin
case checks publication against its actual client. Capability, alteration and
schema-conformance checks pass **86/86 per SQLite mode (172 total)**. PostgreSQL
passes **92/92 per mode**, MySQL **82/82 per mode**: **348 native passes**, no
skips/failures. Both runners exited zero and removed their servers/directories.
Types and lint pass; all 271 source hashes match the tested snapshot. The 271-file snapshot
and logs use `/tmp/library-schema-capabilities-`. Broader A6-12/A6-13 criteria
remain open; no full gate is claimed for this later capability change.
See [schema capability scope](storage-boundaries.md#field-alteration-capabilities).

## 2026-09-11: Shared capability initialization

**105/214 complete; 109 open.** Both storage plugins now call the existing
capability module's `getDatabaseCapabilities`. It shares the version observation
with the window-function check and publishes the same `dbInfo`/`windowFunctions`
shape in both modes. This removes the extra ordinary MySQL/SQLite version query
without introducing a new adapter layer or changing include strategies.

Three direct detector cases count version observations and check their results.
An installed shared-fixture test captures initialization SQL and verifies one
version query plus the published capability shape. The applied capability/include
selection passes **90/90 per SQLite mode (180 total)**. PostgreSQL and MySQL
also pass **90/90 per mode (360 native total)**, with no skips or failures.
Both native runners exited zero and removed their servers/directories. Types
and changed-file lint pass; all 271 source hashes match the tested snapshot.
Logs and the 271-file source snapshot use `/tmp/library-capability-shared-`.
The preceding 11,125-pass full gate is historical evidence for the transaction
checkpoint, not a full run of this later initialization change. A6-12/A6-13
remain open for their broader capability requirements.

## 2026-09-11: Capability boundary audit

**105/214 complete; 109 open.** The [capability inventory](storage-boundaries.md#capability-consolidation-audit)
maps version checks, returning/identity values, temporal representation, schema
ownership, relationships and serialization to their existing owners. It finds
duplicate ordinary startup version probes and different capability shapes between
storage modes. A direct Node 24 probe also reproduces two unparseable-version
boolean-contract failures in the existing helper. After the transaction gate passed, the three version-parser branches were
changed to return explicit booleans. The retained eleven-case regression fails
five cases on the old source and passes all eleven on the fix. Applied capability
and include-limit tests pass **86/86 per mode (172 total)**, including real HTTP
include paths; changed-file lint passes. Logs use `/tmp/library-capability-`.
This small follow-up has targeted verification; the preceding full gate is not
claimed as a full run of the later boolean change.
A6-12/A6-13 remain open; this audit does not substitute for their implementation.

## 2026-09-11: Checked transaction orchestration

**105/214 complete; 109 open.** Strict checking now covers `error-context.js`
and the existing transaction state/context subset. Generic wrappers preserve
request and callback result types. ES2024 library definitions describe the
Node 24 `Promise.withResolvers` implementation; no transpilation is introduced.
An internal declaration covers only the installed hooked-api error class.
The validation-error constructor's existing fields/violations have JSDoc.

The compiler now requires explicit absent-handle/listener guards and narrowing
of Knex's PostgreSQL completion response. No transaction SQL or completion order
changed. Error formatting now reads a message getter once: its new regression
fails against the prior source (0/1) and passes against the change. The existing
error-context suite passes **28/28**. Changed-file lint and type checking pass.
Nine unsuppressed negative calls produce exactly nine compiler errors (exit 2);
the temporary fixture was removed. Logs use `/tmp/library-context-types-`.

The source manifest `/tmp/library-context-types-source.json` records 270 files.
Selected PostgreSQL completion, release and schema-alteration suites passed
**35/35 per mode (70 total)** with no skips; the runner exited zero and its
server/directory were removed. MySQL passed **24/24 per mode (48 total)**,
exited zero and removed its server/directory. Combined native total: **118 passes**,
no skips or failures. The full Node 24 gate exited zero: ordinary **5,147 passes
plus one existing skip**, canonical **5,196**, and Express 4 **390/392**. Total:
**11,125 passes**, with types, both query budgets, lint and docs passing. All
270 source hashes matched the snapshot before the separate capability fix.
`/tmp/library-context-types-audit.json` retains the reconciliation. A6-02 and A9's broader requirements remain open.
See [checked scope and limitations](typechecking.md#transaction-orchestration).

## 2026-09-11: Checked transaction lease boundary

**105/214 complete; 109 open.** `lib/knex-transaction.js` now uses strict checked
JSDoc for its factory, owned handle, release callback, outcome and cleanup
diagnostics. The existing private lease map remains the runtime ownership check.
Explicit absent-handle guards preserve failed-BEGIN/no-transaction cleanup; SQL
completion and release ordering are unchanged. No adapter framework was added.

Node 24 type checking and changed-file lint pass. Five negative calls reject a
plain database, unresolved transaction, invalid outcome, malformed diagnostic
and incomplete transaction. A temporary fixture without suppression directives
exited 2 with exactly five compiler errors, retained in
`/tmp/library-lease-types-negative.log`; the temporary source was removed.
Both SQLite modes pass **12/12** connection-release/completion cases (24 total),
with logs `/tmp/library-lease-types-{knex,anyapi}.log`. The preceding full/native
gate applies to the runtime before these annotations and absent-handle guards;
no new full/native run is claimed. See [typechecking scope](typechecking.md).
A6-02 and A9-02 through A9-06 remain open for their broader requirements.

## 2026-09-11: SQL outcomes survive lease-release failures

**105/214 complete (49.1%); 109 open.** A4-14 and A7-03 are verified. The next cleanup check reproduced a distinction
lost in the first connection-owning factory: COMMIT/ROLLBACK was acknowledged,
but a subsequent pool-release error changed the reported outcome to unknown.
Two public callback regressions fail on the old source after confirming the
actual row count. `/tmp/library-release-outcome-before.log` retains the failures.

The factory now leaves Knex's SQL-completion promise unchanged. It starts lease
release from that promise, while retaining the release result separately until
the library owner finishes. Completion waits for that release result and handles
its error through the existing primary/secondary completion-error logic. An
acknowledged commit remains committed; a confirmed rollback remains rolled back
and preserves the callback error. An unsettled rollback retains its original
rollback diagnostic plus any connection-release error and remains unknown.
Finishing an owner with no established outcome marks any unreleased connection
unusable. Release remains idempotent and no SQL or callback is replayed.

The internal transaction factory receives its owner's context so a failed BEGIN
can retain its original cause and attach a release failure as a secondary
`connectionRelease` diagnostic. Both storage plugins, the registry owners and
the owned PostgreSQL schema runner forward that context; public call signatures
are unchanged. The schema runner's existing private context remains internal.

Four regressions cover acknowledged commit, acknowledged rollback, unsettled
rollback, and failed BEGIN with a release failure. The injected pool method
returns the lease and then rejects; assertions distinguish that cleanup error
from the SQL outcome, verify persisted rows, original/secondary errors and a
single release attempt. BEGIN failure never invokes the callback and a subsequent
write succeeds. Both SQLite modes passed the four-case isolated draft. The actual
working tree passed **317/317** across release, completion, managed writes, write
failures, registry failures/reuse, bulk failures and SQLite alterations. Type
checking passed. Lint initially requested braces around one test assertion; the
braces were added before the full gate.

`/tmp/library-release-outcome-source.json` records the applied source. The expanded
native selection passed **1,476 checks**: PostgreSQL 381 and MySQL 357 per runner
mode, with no skips or failures. Both runners exited zero and all recorded
servers/directories were removed. The full Node 24 gate exited zero: ordinary
5,146 passes plus one existing skip, canonical 5,195 passes, and Express 4
390/392 passes. Total: **11,123 passes, one existing skip**. Types, both query
budgets, lint and documentation passed. All 265 source hashes still match the
tested snapshot. Logs use the prefix
`/tmp/library-release-outcome-`. The preceding unsettled-lease checkpoint passed
the full 11,115-test gate and 1,460 native checks; those results are not described
as verification of this later runtime. The external hooked-api logging failure
still prevents closing the whole-API post-commit/error-preservation guarantees.
Consumer repositories and dependency versions remain unchanged.

### Owned rollback requirement audit (A7-03)

The current source inventory finds seven public resource/relationship writers
registered through `withWriteOutcome` in `rest-api-plugin.js`, plus all three
bulk writers and the callback transaction method. `beginWriteTransaction` binds
accepted work to the owner's handle; ordinary data helpers receive that handle
through `context.db`. A failed accepted operation poisons its unit through
`wrapWriteError` / `failTransaction`, even if its caller catches the rejection.
Only the owner can finish it, and in-flight accepted work is awaited first.

Runtime commit/rollback method calls are centralized in `error-context.js`.
The registry's two owned factories and owned PostgreSQL alterations use the same
completion path. A supplied schema transaction instead owns its savepoint/outer
completion; MySQL DDL explicitly creates no application transaction, and SQLite's
internal rebuild lease/recovery is tested separately. These distinctions match
the published schema contract rather than pretending all DDL is transactional.

The evidence for the owned rollback requirement combines the resource-stage,
bulk-child and relationship-stage matrices, actual pivot/reverse linkage
snapshots, managed caught-failure/concurrency cases, registry persistence/cache
checks, and the completion/lease regressions. Known pre-commit failures restore
the owned row/linkage/metadata state; failed completion is reported as unknown
instead of inventing a rollback acknowledgement. The completed full/native gate
and matching source snapshot close A7-03. The separate dispatcher error and
post-commit evidence limitations still keep A7-04/A7-05/A7-06 open.

### Explicit response preparation and completion audit (A4-14)

POST, PATCH and both PUT branches await `handleRecordReturnAfterWrite` before
`commitOwnedTransaction`. The helper refreshes current state, borrows the write
transaction for a full response GET, awaits both finish hooks, normalizes the
selected representation and returns a detached clone. DELETE and all relationship
writers await their finish hooks before the same owner completion helper and
return no record. Bulk children finish their selected record preparation before
the atomic owner commits; final aggregate status describes the completed unit.

`commitTransaction` and `rollbackAfterError` remain the central SQL completion
and cleanup entrypoints. Response-preparation errors therefore follow owned
rollback; after-commit observers cannot mutate the detached record returned to
the caller. The lifecycle matrices include finish-value/clone failures, returning
modes, response isolation, composed bulk/relationship work and owner identity.
This source review and the current full/native gate supply A4-14's completion
ordering evidence without inventing a new lifecycle framework. Consumer-dependent
hook/response migration items remain separately open.

## 2026-09-11: Unsettled transaction leases and post-commit review

**103/214 complete; 111 open. A7-03/A7-04 remain open.** The next ownership
review reproduced an additional lease failure: a rollback method rejected before
settling Knex's completion promise. The API returned an unknown outcome, but the
pool retained one used connection, the handle remained incomplete, and a queued
borrower timed out. The diagnostic `/tmp/library-unsettled-rollback-probe.log`
confirms all four observations; manual test cleanup afterward completed the old
transaction. Existing mocked rollback-failure tests also performed that cleanup,
so they did not expose the retained lease.

The Knex factory now keeps a private weak mapping to an idempotent lease-release
operation. An owner finishing with outcome unknown discards an unreleased lease
before its finalizers run, even if the driver completion promise has not settled.
The connection is marked disposed before pool release. A later promise settlement
cannot release it again. The core records release errors as secondary
`connectionRelease` diagnostics without replacing the original failure. As with
the earlier disposal mechanism, physical close is delegated to Knex's pool;
this does not promise immediate server-side rollback or resolve commit uncertainty.

A new public callback regression queues a borrower, rejects rollback before
completion settlement, verifies the original/secondary errors, obtains a different
connection, reads back the rolled-back row state, rejects reuse of the old managed
handle, and completes a fresh write. The selected five-file SQLite run passes
**240/240**. Its first run exposed the secondary-failure suite's in-memory schema
being lost on connection disposal; that suite now uses file-backed SQLite, as do
the existing driver-failure suites. Combined native and full Node 24 checks are
running against `/tmp/library-unsettled-lease-source.json`; this latest runtime is
not yet a full checkpoint.

The first full invocation exited one during its ordinary suite: 5,123 passed,
19 failed, one existing skip. All failures were in the atomic-bulk fixture after
its first rejected rollback discarded the in-memory SQLite connection and schema.
That fixture now also uses file-backed SQLite. Its full file passes **53/53 in
each SQLite mode** and **212/212 native checks** (53 per database/mode).
Both native runners exited zero and their disposable servers/directories were
removed. The corrected full gate exited zero: **11,115 passes**, one existing skip
(5,142 ordinary / 5,191 canonical / 390 and 392 Express 4). Type checking, both
query budgets, lint and docs passed. The ordinary/canonical durations were
172.212s / 194.540s; Express 4 took 17.807s / 19.812s. The original
failure log is retained as `/tmp/library-unsettled-lease-gate.log`; the corrected
gate uses `/tmp/library-unsettled-lease-complete-gate.log`. Only that fixture file
differs from the first gate's source manifest; the new complete-source manifest
records the correction. The preceding seven-file native selection passed
**1,248 checks** (PostgreSQL 324 and MySQL 300 per mode), with zero skips/failures
and verified server/directory cleanup.

The release-error diagnostic branch and acknowledged-completion behavior remain
part of the A7-05 follow-up audit; selected passing checks do not close that item.

The post-commit review strengthened existing implicit/managed tests to count
rollback method calls, not just inspect persisted rows. Both tests pass in each
SQLite mode. A process-local mutation deliberately attempts rollback after commit
while preserving the original rejection; both tests then fail in each mode with
`1 !== 0` at the rollback-count assertion. The isolated draft passed **678 native
checks** (PostgreSQL 175 and MySQL 164 per runner mode) before application. These
test changes add no runtime branch or alternate dispatcher. Logs are retained as
`/tmp/library-postcommit-rollback-{knex,anyapi}-{correct,mutation}.log` and
`/tmp/library-postcommit-rollback-{pg,mysql2}.log`.

A separate public-path diagnostic confirms why A7-04 cannot close yet: when an
after-commit hook fails and the installed hooked-api diagnostic logger also
throws, the caller receives the logger error **without `transactionOutcome`**.
The caller's context still says committed and the row is persisted. The evidence
is `/tmp/library-postcommit-logging-probe.log`; this relates to the existing
[pending dispatcher patch](pending-hooked-api/README.md), which is still not
installed/released. The core rollback guard is verified, but the whole API's
post-commit evidence guarantee remains incomplete. A7-05/A7-06 also remain open.
Consumer repositories and dependency versions are unchanged.

## 2026-09-11: Schema completion and connection cleanup

**A7-F12, schema checkpoint verified. Checklist unchanged: 103/214.**
The last direct PostgreSQL callback transaction in `alterKnexFields` reproduced
the waiting-borrower bug: 18 existing tests passed and two COMMIT-failure
regressions failed before the correction. Owned alterations now reuse
`withWriteOutcome(transactionMethod)` and the shared connection factory, rather
than duplicate completion/rollback handling. Borrowed PostgreSQL alterations
retain their Knex savepoint; the library never completes the outer owner.
Expanded PostgreSQL checks passed **23 per runner mode (46 total)**, including
COMMIT acknowledged as ROLLBACK and lost savepoint release before/after execution.
The latter assert the parent remains active until its callback owner rolls back,
with no library-issued outer completion and no surviving schema change.

The SQLite audit found two hidden Knex transactions: reading the original schema
and rebuilding the table. The initial rebuild regressions also reproduced unsafe
reuse: 14 existing cases passed and two new cases failed. The SQLite alteration
path now leases a connection for all its SQL, including introspection and the
Knex-managed rebuild. It retains only the SQL capabilities this helper uses
(`client`, bound `raw`, bound `schema`); it does not emulate general Knex calls.
On error, it rolls back a transaction the driver reports active and restores the
original foreign-key setting before release. An unverifiable or failed cleanup
marks the connection disposed; `AggregateError` retains both failures and the
original cause. A completed, verified clean SQLite connection may be reused even
when the call's COMMIT acknowledgement was lost; no outcome is inferred from
that reuse and no write is replayed.

The initial SQLite probe required connection replacement even after a COMMIT
had actually finished. The final contract instead permits a verified clean
connection to be reused. Against an isolated copy of the original runtime, the
final two before-COMMIT assertions fail because `inTransaction` is still true;
the two after-COMMIT controls pass. Logs
`/tmp/library-sqlite-ddl-final-before.log` and `-final-after-control.log` distinguish
the actual unfinished-transaction bug from the earlier conservative replacement
assertion. No runtime dependency or source file is replaced by that temporary
comparison loader.

Six SQLite cases cover schema-read/rebuild completion before and after execution,
rollback-cleanup failure, and foreign-key-restoration failure, with a borrower
already queued. They assert clean transaction state, actual persisted defaults,
foreign-key enforcement and, when cleanup fails, connection replacement and
original/secondary errors. The SQLite alteration file passes **20/20**. Before
the last four additions, the combined resource/registry/DDL selection passed
255/255; that narrower checkpoint is retained rather than described as current
combined verification. The helper's old manual rollback cleanup now checks whether
a SQLite transaction is still active, so it does not issue a redundant rollback
after the library has already cleaned the connection.

Evidence: `/tmp/library-ddl-completion-before.log`, `-after.log`, `-expanded.log`,
`/tmp/library-sqlite-ddl-completion-before.log`, `-after.log`, and
`/tmp/library-sqlite-ddl-cleanup.log`. Initial lint found two mixed initialized
`let` declarations in the tests; they were split before the current gate.
`/tmp/library-ddl-completion-source.json` records the combined runtime/test source.
The combined native selection passed **1,244 checks**: PostgreSQL 323 per runner
mode and MySQL 299 per mode, with no skips/failures. Both runners exited zero and
all recorded disposable database directories and server processes were removed.
This selection includes resource completion, managed writes, write failures,
registry failures/reuse, direct field alteration and schema conformance. The full
Node 24 gate exited zero: 5,141 ordinary tests (one existing skip), 5,190 canonical,
390 Express 4 ordinary and 392 Express 4 canonical, for **11,113 passes**.
Durations were 297.406s / 242.116s / 41.949s / 25.810s. Type checking, both query
budgets, lint and docs passed. `/tmp/library-ddl-completion-gate-audit.json`
records the totals; the source hash manifest remained unchanged through the gate.
This checkpoint precedes the unsettled-lease correction below. Consumer
repositories and dependency versions remain unchanged.

## 2026-09-11: Registry connection ownership

**103/214 complete; 111 open.** A7-F12 now also covers the two owned metadata
factories in `AnyapiRegistry`. Registration and field allocation use the shared
connection-owning factory; supplied managed transactions retain their existing
owner. Existing failure tests intercept newly acquired handles while forwarding
the actual transaction configuration, so they exercise the real connection lease.
The deliberately invalid savepoint factory still tests ownership rejection.

Four new public registry regressions fail on the old source, then pass after the
change: registration/allocation lose COMMIT before or after execution while a
borrower waits on a single-connection pool. They assert different connections,
read back the actual persisted descriptor, and successfully allocate a subsequent
field before any interceptor cleanup. Existing tests retain rollback, typed and
non-Error failures, logging failures, cache invalidation and managed participation.

An isolated draft using process-local module loading passed 68 SQLite checks and
**278 native checks**: PostgreSQL 71 and MySQL 68 in each runner configuration.
These fixtures explicitly use canonical storage in both configurations. Both
native runs exited zero and their disposable servers/directories were removed.
The applied registry runtime is byte-identical to that native-tested draft;
the applied interception test only adds braces required by lint.
The new regression's absolute temporary imports were converted to repository
relative imports, then the actual working-tree tests passed **68/68** on SQLite.
Logs: `/tmp/library-registry-connection-draft-{pg,mysql2}.log` and
`/tmp/library-registry-connection-applied.log`. The draft loader is temporary and
is not imported or shipped by the library.

Applied-source type checking and lint pass. Lint initially found a misplaced
space in a test call and missing braces around the test interception branch;
both formatting issues were corrected. Documentation was rebuilt and the rendered
registry evidence and outcome pages were checked.

The preceding full gate covers the storage-owner fix; the later registry change
has selected verification so far. The PostgreSQL DDL callback transaction in
`dbTablesOperations.js` remains to audit, so A7-F12 does not yet establish
library-wide completion isolation. Consumer source and dependency versions are
unchanged. The checklist remains open where broader requirements remain.

## 2026-09-10: Failed-completion connection ownership

**A7-F12, storage-owner checkpoint verified. Checklist unchanged: 103/214.** A driver
completion rejection previously returned the physical connection to Knex's pool
with unfinished SQL transaction state. The earlier completion helper manually
rolled it back, hiding subsequent-request behavior. Diagnostic probes reproduced
reuse on SQLite, PostgreSQL and MySQL in both storage modes: SQLite/MySQL reads
saw the unfinished row, and PostgreSQL reads failed with an aborted transaction.

The new `conformance-completion-connections.test.js` queues a borrower while a
single-connection pool is occupied. Four regressions fail before the fix on
SQLite and in the first storage mode of each native runner (the runners stop on
failure). They cover COMMIT/ROLLBACK rejection before execution and loss of the
acknowledgement after execution. The tests assert different physical connections,
actual surviving rows, and a subsequent successful write, before helper cleanup.
Two controls prove acknowledged COMMIT/ROLLBACK still reuse their connection.
A BEGIN query-listener failure proves the callback never starts and the lease
is released safely. Its first run exposed Knex returning an already-failed
transaction, now rejected by the factory before application work starts.

Both storage plugins share `lib/knex-transaction.js`, which acquires the pool
lease and supplies it through Knex's transaction connection option. The factory
marks rejected transactions' connections disposed before release, using Knex's
pool validation mechanism; it does not depend on promise callback ordering after
Knex has already released the connection. Initial acquisition/BEGIN failure also
releases the lease. No SQL write or arbitrary callback is retried. Existing
completion fixtures now use file-backed SQLite so connection disposal cannot
erase their in-memory schema; the interceptor does not manually query a disposed
connection. Disposal can leave locks until pool eviction/disconnection and does
not resolve commit uncertainty. These are injected driver/event-boundary tests,
not physical network-loss or failover verification.

Expanded verification passed **706 native checks**: PostgreSQL 182 per mode
(74.049s / 114.745s), MySQL 171 per mode (80.245s / 121.447s), no skips or failures.
Both native runners exited zero and their database directories/server processes
were removed. The full Node 24 gate also exited zero:

| Stage | Passed | Skipped | Duration |
| --- | ---: | ---: | ---: |
| Ordinary storage | 5,131 | 1 existing | 284.239s |
| Canonical storage | 5,180 | 0 | 194.533s |
| Express 4 ordinary | 390 | 0 | 42.163s |
| Express 4 canonical | 392 | 0 | 34.480s |

**11,093 passes**, one existing skip. Type checking, both query-budget runs,
lint and docs passed; rendered outcome/evidence pages contain the new content.
`/tmp/library-connection-ownership-gate.log`, `-source.json` and `-audit.json`
retain the command results and unchanged-source check. The package files and
parked consumer patch retain their previous hashes. This full gate precedes the
registry follow-up below; it does not claim that later runtime was fully gated.

The follow-up factory inventory found two remaining direct owners in
`AnyapiRegistry.registerResource` / `allocateField`, plus the PostgreSQL DDL
callback transaction in `dbTablesOperations.js`. Registry probes in
`/tmp/library-registry-connection-probe.test.mjs` reproduce the same waiting-borrower
failure for registration/allocation before and after COMMIT execution: 0/4 pass
on SQLite. These paths were not fixed by the storage-plugin change; the verified registry
follow-up below applies the same factory. The DDL owner still needs completion-failure review;
no claim of library-wide connection isolation is made at this checkpoint.

## 2026-09-10: Relationship failure-stage traces

**103/214 complete (48.1%); 111 open.** A80/138, B21/48, M2/14,
C0/14. **A4-05 is complete.** Consumer/seed work remains paused.

Added 244 stage-injection cases to the existing relationship composition suite.
Pivot and reverse POST/PATCH/DELETE endpoints fail at each retained endpoint or
nested PATCH hook, plus each enlisted afterCommit hook, under implicit and
explicit managed owners. Successful and failed cases now share one expected
composition helper; expectations are not generated from runtime observations.

Repeated early processing stages distinguish the old/new child by occurrence,
so failures can reach either child's preparation. Expected rollback traces
include only operations whose defined start was reached, in reverse order; a
child rejected before validation retains an unset completion-hook ID. All cases
assert exact awaited entry/exit order, original cause, owner outcome, context
count, one shared transaction, completion flags, and actual restored/committed
linkage. Post-commit failures retain changed data and run later completion chains.
The new matrix passed without a runtime correction.

Together with existing resource-stage injection and the 114 bulk cases, this
completes the selected A4-05 lifecycle requirement. A7 still owns arbitrary
extension throws, logging boundaries and uncertain driver completion; its open
items are not implicitly completed by these typed-hook failure tests.

Node 24.6.0: **826/826 per invocation, 4,956/4,956 total**, no failures/skips:

| Database | Ordinary / canonical duration |
| --- | --- |
| SQLite | 47.773s / 53.686s |
| PostgreSQL 16.15 | 65.043s / 52.191s |
| MySQL 8.0.46 | 65.375s / 54.902s |

All runs reached terminal exit 0. Native servers/directories are removed;
changed-file lint passes. Only the lifecycle test changed since the preceding
source manifest; the runtime and installed dependency remain unchanged. The
previous full runtime gate retains its recorded scope, without claiming another
full-library run for these added tests.

Logs: `/tmp/library-relationship-stage-focused-{knex,anyapi}.log`,
`/tmp/library-relationship-stage-complete-{knex,anyapi}.log`,
`/tmp/library-relationship-stage-{pg,mysql2,lint}.log`.
Tested source manifest: `/tmp/library-relationship-stage-source.json`.
The lifecycle guide describes the reached-operation and failure-stage contract.

## 2026-09-10: Bulk child failure-stage traces

**102/214 complete (47.7%); 112 open.** A4-05 remains open for the remaining
composed relationship-stage injections. Consumer/seed work remains paused.

Added 114 failure cases to the existing composed bulk suite. Each retained
POST/PATCH/DELETE write hook/setter and afterCommit hook rejects in the second
child of a three-entry batch, under owned atomic, non-atomic and explicit managed
ownership. Expected traces reuse the selected resource stages; the fixture and
bulk input construction remain shared with the successful composition cases.

Before commit, assertions verify exact trace truncation, rollback completion
order, the original cause and outcome, no third-child execution for atomic
work, and all original rows restored. Non-atomic cases verify the first and
third children commit while the failed second child rolls back, with the correct
indexed error. After commit, all mutations persist, later completion chains run,
and the failure remains committed. Non-atomic counts distinguish rejected calls
from committed mutations. Context counts, shared/separate transaction identities,
awaited hooks and completion flags are asserted throughout. No runtime code
changed, and the new failure matrix passed without an implementation correction.

Node 24.6.0: **582/582 per invocation, 3,492/3,492 total**, no failures/skips.
SQLite durations: 22.036 / 24.997s; PostgreSQL 16.15: 33.752 / 29.492s;
MySQL 8.0.46: 31.414 / 29.736s (ordinary/canonical respectively).
Changed-file lint passes; native servers and disposable directories are gone.
The lifecycle guide explains these failure distinctions and retains A4-05's
remaining relationship work.

Only `conformance-lifecycle.test.js` changed since the prior tested source
manifest. The last full runtime gate remains evidence for unchanged runtime;
no fresh full-library gate is claimed. Logs:
`/tmp/library-bulk-stage-complete-{knex,anyapi}.log`,
`/tmp/library-bulk-stage-{pg,mysql2,final-lint}.log`.
Tested source manifest: `/tmp/library-bulk-stage-source.json`.

## 2026-09-10: Composed relationship lifecycle traces

**102/214 complete (47.7%); 112 open.** A79/138, B21/48, M2/14,
C0/14. **A4-03 is complete.** Consumer/seed work remains paused.

Added 88 relationship-composition cases to the existing lifecycle file, reusing
its selected PATCH stage expectations. Supported POST/PATCH/DELETE relationship
endpoints cover ordinary and inverse many-to-many, hasMany, hasOne, belongsTo,
polymorphic and reverse polymorphic relations, with explicit PATCH clearing.
Each runs under owned commit, owned finish rejection, managed commit and managed
callback rollback. Cases verify awaited enter/exit order, separate wrapper/source/
child contexts, one shared transaction, no premature managed completion, commit
order/reverse rollback order, and actual restored/committed linkage.

The traces distinguish direct pivot SQL from nested child PATCHes. PATCH
relationship enlists a source PATCH; reverse replacements remove the old child
before adding the new one. Source after-data hooks precede child work, source
finish hooks follow it, and endpoint finish hooks run last before completion.
The initial expectations incorrectly placed the ID in early nested PATCH
processing hooks; existing resource tests and setup source confirm it is cleared
until the validation phase. Correcting that expectation made all initial 60
cases pass; 28 explicit clearing cases then completed the selected matrix.
No runtime behavior changed.

Together with the previous twelve bulk cases, this completes A4-03's composed
trace requirement. Consumer-visible field inventory/migration (A4-01/A4-04),
each-stage failure coverage (A4-05), and the broader failure/extension audit
remain separate open requirements. The lifecycle guide now documents the
verified composition and its scope.

Node 24.6.0: **468/468 per invocation, 2,808/2,808 total**, no skips/failures:

| Database | Ordinary / canonical duration |
| --- | --- |
| SQLite | 15.654s / 17.663s |
| PostgreSQL 16.15 | 24.721s / 22.355s |
| MySQL 8.0.46 | 22.079s / 22.016s |

All runs reached terminal exit 0; native servers and temporary directories are
gone. Changed-file lint passes. Only the lifecycle test changed since the prior
source manifest. The previous full runtime gate remains valid for unchanged
implementation; this checkpoint does not claim a fresh full-library gate.
Logs: `/tmp/library-relationship-trace-complete-{knex,anyapi}.log`,
`/tmp/library-relationship-trace-{pg,mysql2,final-lint}.log`. Tested source manifest:
`/tmp/library-relationship-trace-source.json`.

## 2026-09-10: Composed bulk lifecycle traces

**101/214 complete (47.2%); 113 open.** A4-03 remains open for the complete
relationship traces. Consumer/seed work remains paused.

Added twelve bulk-composition cases to `conformance-lifecycle.test.js`, reusing
its existing resource-stage expectations. Bulk POST/PATCH/DELETE each run in
owned atomic, non-atomic, explicit managed commit and managed callback rollback
modes. Every observed hook/setter records entry and awaited exit. Assertions
cover exact per-child order, two distinct child contexts, shared versus separate
transaction identities, no premature managed completion, acknowledged completion
flags, commit order/reverse rollback order, no duplicate bulk-owner hook chain,
and final persisted rows. The selected response mode is none; existing resource
traces cover full-response nested GETs. No runtime refactor was needed.

The initial new POST test used an incorrect argument name; inspection of the
existing bulk method confirmed `inputRecords`. Correcting the test input made
all twelve cases pass. The lifecycle document now distinguishes current private
ownership, error outcomes and verified managed integration from the historical
A7-F01 implementation. It also keeps the installed dependency's error-loss issue
and remaining relationship traces explicit.

Node 24.6.0: the complete lifecycle file passes **380/380 in each of six
invocations (2,280/2,280)**, no failures or skips:

| Database | Ordinary / canonical duration |
| --- | --- |
| SQLite | 2.954s / 3.366s |
| PostgreSQL 16.15 | 4.345s / 13.929s |
| MySQL 8.0.46 | 13.884s / 10.994s |

Changed-file lint passes; native servers and disposable directories are gone.
Only this test source changed since the last full runtime gate. That gate's
10,163 passes and 748 native/Redis checks remain the evidence for unchanged
runtime; no fresh full gate is claimed for this test/documentation addition.
Logs: `/tmp/library-bulk-trace-complete-{knex,anyapi}.log`,
`/tmp/library-bulk-trace-{pg,mysql2,lint}.log`. Tested source manifest:
`/tmp/library-bulk-trace-source.json`.

## 2026-09-10: Deferred broadcast failure isolation

**101/214 complete (47.2%); 113 open.** A78/138, B21/48, M2/14,
C0/14. **A7-10 is complete and A7-F11 is corrected.** No consumer/seed work
was performed. The separate dependency/error-boundary work remains open.

**A7-F11:** draining a committed transaction's notification queue removed it
from the pending map before delivery, then abandoned every later notice when
one adapter call rejected. Later operation completion chains could not recover
those notices because the queue was already consumed.

The existing drain now attempts each queued notice in capture order. It records
failed attempts on the draining operation context as
`{ phase: 'socketioBroadcast', broadcastIndex, error }`, retains the first
failure for rejection, and never replays the queue through a later chain.
Committed data and already emitted notices remain committed/delivered. A notice
may fail after some recipient deliveries; no recipient acknowledgement, durable
retry or exactly-once guarantee was added.

The new WebSocket and HTTP-polling regression commits three updates, pauses
before delivery, injects two adapter lookup failures, then confirms the third
notice arrives exactly once in that run. It checks all three attempts, both
original diagnostic errors and their indexes, first-error identity, the committed
outcome and final stored data. Both cases fail on the previous source (only one
attempt); both pass in each storage mode with the fix.

A7-10 coverage map:

| Required behavior | Evidence |
| --- | --- |
| Resource writes and commit | `socketio-contract` and authorization suites verify CRUD notices, PUT creation, HTTP writes, visibility entry/exit, subscription generations and post-commit row state. |
| Relationship writes | The contract suite checks POST/PATCH/DELETE relationship parent notices and reverse-child changes, actual linkage, hook ordering, rejected targets and rollback of changed children. |
| Managed commit/rollback | Authorization cases hold the callback pending, check silence, then verify repeated writes, callback/caught-write/caught-SQL failures and later completion chains. |
| Atomic/non-atomic batches | Local and Redis cases compare stored records/linkage with delivered notices, including middle-entry failure and rejected rollback cleanup. |
| Side-effect failure | The new adapter-failure regression verifies later notice attempts and retained diagnostics; existing query-denial/failure checks suppress unauthorized notices. |
| Delivery limits | Socket.IO and migration guides document partial delivery, consumed queues, unknown outcome, no automatic replay and no exactly-once guarantee. |

Node 24 selected results, terminal exit 0:

- Focused new regression: 2/2 per storage mode; old source 0/2.
- PostgreSQL 16.15: 164/164 per storage mode, 81.340s/134.066s.
- MySQL 8.0.46: 164/164 per storage mode, 122.205s/176.569s.
- Redis 7.0.15: 46/46 per storage mode, 59.574s/67.544s.
- Total native/Redis checks: **748/748**, no skips. The initial Redis run failed
  12 stale cleanup-diagnostic assertions: the managed contract now includes
  `operationIndex`, `scopeName` and `method`. Updating those exact expectations
  made the complete Redis selection pass; delivery/storage checks remain intact.
- The full Node 24 gate passes, terminal exit 0: **10,163 tests passed**, one
  existing skip. Ordinary storage 4,666/4,667 (277.397s); canonical storage
  4,715/4,715 (181.672s); Express 4 ordinary 390/390 and canonical 392/392.
  Types, both query-budget runs, repository lint and docs build pass.
- All native database/Redis servers and disposable directories are removed.

The only runtime edit is the Socket.IO queue-drain loop. Since the full gate
started, only the separately executed Redis integration assertion changed; that
file is outside the full gate's default test glob. Tested source manifests:
`/tmp/library-broadcast-failure-source.json` and
`/tmp/library-broadcast-failure-complete-source.json`.
Logs: `/tmp/library-broadcast-failure-{before,focused-knex,focused-anyapi,pg,mysql2,redis,redis-corrected,gate}.log`.

## 2026-09-10: Pending dependency logging failure isolation

**100/214 complete (46.7%); 114 open.** The installed dependency remains
unchanged, so A7-05/A7-06 remain open.

Extended the [retained upstream patch](pending-hooked-api/README.md) to prevent
synchronous diagnostic logger failures from replacing rejected API-method,
scope-method or hook failures. A shared upstream helper records each logger
failure on the mutable call context as a secondary logging diagnostic and lets
the dispatcher rethrow the identical primary value. No library runtime shim or
consumer change was made.

Added 24 upstream cases with null/undefined/frozen/typed primaries and Error/null
logger failures. All 24 fail on the previous null-formatting-only patch. Against
unmodified 1.0.24, the full added suite has 18 passes and 30 failures. The extended
patch passes **295/295 upstream tests**, including all 48 new cases. The retained
library regression now crosses preparation/finish/afterCommit, null/undefined,
and successful/failing logging: **12/12 per storage mode**, preserving cause,
actual row state, outcome and secondary diagnostics. All 12 fail against the
installed dependency. All runs use Node 24.6.0.

The saved patch was reapplied to a clean temporary base and its resulting source
hash matches the tested copy. The manifest and application instructions are
updated. Plugin installation and success/debug/asynchronous logging remain
explicitly separate audit work. This is dependency preparation, not a claim that
the installed library has these guarantees yet.

Logs: `/tmp/library-hooked-logging-{base,before,after,installed}.log` and
`/tmp/library-hooked-logging-integration-{knex,anyapi}.log`.

## 2026-09-10: Pending hook-dispatcher dependency correction

**100/214 complete (46.7%); 114 open.** No checkbox closes: A7-05/A7-06
still require an installed dependency fix and broader boundary review.

Reproduced the installed hooked-api 1.0.24 dispatcher defect and confirmed the
npm registry still lists that version. Null/undefined hook failures are replaced
by TypeError while accessing `error.message`. An isolated upstream patch changes
only diagnostic formatting in the API/scope/hook catches and preserves the
original thrown value. The new 24-case upstream suite fails six cases before
the patch; all 271 upstream tests pass with it on Node 24.6.0.

A retained json-rest-api integration regression verifies original cause,
transaction outcome and persisted rows for preparation, finish and after-commit
hooks. All six cases fail against the installed dependency and pass with the
isolated patch in each storage mode (12/12). The first integration probe omitted
the fixture's required logical ID; corrected input now reaches all intended
hooks. No library-runtime correction is claimed from the isolated result.

The [patch, base hashes, regression and application instructions](pending-hooked-api/README.md)
are retained in this repository so the work does not depend on a temporary
checkout. Package/lock, installed dependency and the clean sibling hooked-api
repository remain unchanged. No consumer repository or seed was changed.
Logging failures and plugin-installation wrapping are explicitly outside this
small patch and remain audit work, not silently accepted behavior.

Logs: `/tmp/library-hooked-api-before.log`, `/tmp/library-hooked-api-after.log`,
`/tmp/library-hooked-api-installed.log`, `/tmp/library-hooked-api-final-{knex,anyapi}.log`.
The test-only module-resolution override is not installed in the library.

## 2026-09-10: Commit uncertainty documentation

**100/214 complete (46.7%); 114 open.** A77/138, B21/48, M2/14,
C0/14. **A7-12 is complete.** Consumer repositories/seeds remain untouched.

Reconciled the outcome contract, public API reference and migration guide with
current managed completion. The new
[commit uncertainty section](../GUIDE/transaction-outcomes.md#when-commit-acknowledgement-is-lost)
explains the evidence for all five outcomes, why a rejected call can follow a
committed write, and why unknown completion cannot authorize replay or file
deletion. It documents primary/secondary errors, participant snapshots, skipped
outcome hooks, external effects that survive database rollback and the absence
of durable/exactly-once delivery. Stale claims that B2 file/event integration is
still unfinished were corrected; consumer migration remains explicitly paused.

Reviewed `commitTransaction`, `rollbackAfterError`, `finishTransaction` and the
actual driver-query interception helper. Tests reject before execution or after
real COMMIT/ROLLBACK execution, inspect persisted rows, and assert no outcome
hooks run on unknown completion. The documentation now explicitly distinguishes
that evidence from physical network partitions and server failovers, which these
checks do not simulate. No claim of solving an unreceived acknowledgement is
made. The broader A7 implementation/extension audit remains open.

This checkpoint changes documentation only. Node 24.6.0 rechecks of
`conformance-managed-transactions.test.js` and `error-context.test.js` pass
**66/66 per storage mode (132 total)**, no failures or skips, in 0.671s/0.730s.
Logs: `/tmp/library-outcome-docs-{knex,anyapi}.log`. The prior native/full-gate
results retain their recorded scopes; no new native/full-gate run is claimed.

## 2026-09-10: Concurrent conflicts without replay

**99/214 complete (46.3%); 115 open.** A76/138, B21/48, M2/14,
C0/14. **A7-11 is complete.** Consumer and seed work remains paused.

The existing `conformance-transactions.test.js` suite uses separate physical
connections and bounded rendezvous, not mocked transactions. It checks pending
write visibility, repeatable reads, lock contention, relationship replacement
serialization, parent/target deletion races, disjoint PATCH updates, atomic bulk
commit/rollback visibility and concurrent generated IDs. PostgreSQL and MySQL
also execute a native deadlock and verify only the survivor's changes persist;
SQLite verifies stale snapshots and its single-writer conflict instead.

The new case holds a winning update open, attempts a conflicting update through
another managed owner, and records the losing field setter and before-data hook
in an external array. It asserts one invocation each, the native conflict code,
no replay during owner completion, and the winning committed row. PostgreSQL
uses a local 250ms lock timeout; MySQL temporarily uses a one-second session
limit and restores it before returning the connection. These effects remain in
the array after database rollback: no external compensation is implied.

Initial runs caught an incorrect test expectation about hook/setter order;
source inspection confirms the hook runs before the data adapter invokes the
setter. Correcting the assertion required no runtime change. All existing
concurrency cases also pass with the callback-enabled shared fixture.

Final Node 24.6.0 runs, all terminal exit 0, no failures or skips:

| Database | Ordinary storage | Canonical storage |
| --- | --- | --- |
| SQLite | 34/34 | 34/34 |
| PostgreSQL 16.15 | 35/35 | 35/35 |
| MySQL 8.0.46 | 35/35 | 35/35 |

**208/208 passed.** Changed-file lint passes. Native server PIDs and temporary
directories are removed. Only the concurrency test changed since the preceding
273-file source manifest; runtime and dependency/parked migration files are
unchanged. The preceding full gate remains evidence for unchanged runtime;
these selected runs are not a fresh full-library gate.

The managed transaction guide now explicitly describes no replay and external
effects that survive rollback. Logs: `/tmp/library-no-replay-corrected-{knex,anyapi,pg,mysql2}.log`
and `/tmp/library-no-replay-corrected-lint.log`. Tested source manifest:
`/tmp/library-no-replay-source.json`. Remaining A7 ownership, cleanup, typed-error
and side-effect guarantees still require their own reconciliation.

## 2026-09-10: File lifetime and failure coverage

**98/214 complete (45.8%); 116 open.** A75/138, B21/48, M2/14,
C0/14. **A7-09 is complete.** Consumer repositories and seeds remain paused.

The file ownership decision follows a tested legal use: two documents may store
the same URL. Deleting an old object whenever one field changes would break the
other document. File fields therefore remain opaque handles. The operation owns
new-upload cleanup until completion; confirmed commit transfers lifetime control
to the application. Previously committed objects survive PATCH/PUT replacement
and DELETE, even after the last local reference disappears. Applications can
explicitly delete objects after establishing ownership and absence of references
across their consumers. No implicit asset registry or compatibility layer was
added. Earlier notes calling automatic old-file deletion unfinished are
superseded by this explicit contract, not a claim that garbage collection exists.

A7-09 requirement evidence:

| Requirement | Exercised evidence |
| --- | --- |
| Upload followed by validation failure | `file-handling.test.js` checks successful upload, subsequent schema rejection, temporary cleanup and stored-object deletion. |
| Upload followed by database failure | New cases observe the actual driver's `query-error` from a duplicate document ID, retain it as the cause, confirm rollback, preserve the existing row and remove the new LocalStorage object/tracking. |
| Upload followed by relationship failure | New cases read the changed child's document relationship inside the transaction before its finish hook rejects; rollback restores the unlinked child, removes the parent and deletes its uploaded file in both formats. |
| Rollback cleanup failure | Existing conformance cases assert ordered attempts on later files, retained failed-upload tracking, original write cause and secondary cleanup/logging errors, including repeated replacement followed by DELETE. |
| Replacement and deletion | Twelve new cases cross PATCH/PUT/DELETE, commit/rollback and plain/JSON:API; inspect actual old/new bytes, shared references, restored or committed rows, and cleared tracking. Deleting the remaining records also preserves committed objects. |
| Temporary-file consistency | Existing conformance and multipart cases inspect real temporary files after success, failure and cancellation; a failed cleanup does not prevent later attempts and remains diagnosable. LocalStorage cases cover source consumption and partial destination cleanup. |

Only `tests/conformance-file-failures.test.js` and the optional `withNotes`
fixture in `tests/fixtures/api-configs.js` changed since the previous full gate.
The runtime, package metadata/lock and parked migration patch did not change.
The first focused run exposed an incorrect plain-format test input (objects
instead of the documented array of IDs); correcting that input gives 20/20 per
storage mode. No parser change was needed.

Node 24.6.0 verification, all terminal exit 0:

- Five affected file/parser/multipart suites: **166/166 per storage mode**,
  332 total, no skips (5.377s / 5.733s).
- Native file-failure suite: PostgreSQL 16.15 **105/105 per storage mode**;
  MySQL 8.0.46 **101/101 per storage mode**; **412/412 total**, no skips.
  PostgreSQL took 8.640s / 13.440s; MySQL 11.245s / 12.074s.
- Repository lint passes. Native server PIDs and disposable directories are gone.
- The previous full gate remains the evidence for unchanged runtime: 10,121
  passes, one existing skip, types/query budgets/Express 4/lint/docs passing.
  This checkpoint's selected runs are additional coverage, not a new full gate.

Logs: `/tmp/library-file-lifetime-selection-{knex,anyapi}.log`,
`/tmp/library-file-lifetime-{pg,mysql2}.log`,
`/tmp/library-file-lifetime-lint.log`. Tested source manifest:
`/tmp/library-file-lifetime-source.json`. File ownership, migration and managed
transaction guides describe the selected contract.

## 2026-09-10: Exclusive local upload allocation

**97/214 complete (45.3%); 117 open.** Counts remain A74/138, B21/48,
M2/14 and C0/14. **A7-F10 is corrected**, but A7-09 remains open for
the remaining file ownership/replacement/deletion contract and coverage.
Consumer, seed and positioning work remains paused.

LocalStorage previously checked a filename's availability and later wrote or
renamed into it without exclusive creation. Two concurrent original/custom-name
uploads could receive the same URL and overwrite bytes. A subsequent database
rollback could then delete a previously committed file. Its availability check
also treated a dangling symlink as an unused name and followed it when writing.

Uploads now reserve their destination with `open(..., 'wx')`. An occupied-name
error chooses another available name and retries only reservation; the custom
name generator is not rerun. Buffer data writes through the reserved handle.
Temporary-file data streams into it and its source is removed only after the
destination write and close succeed. Failure closes/removes only that upload's
reserved destination. Cleanup failure produces an AggregateError retaining the
original cause and the ordered cleanup failures. `lstat` counts dangling links
as occupied, and non-ENOENT inspection failures propagate.

Only `plugins/storage/local-storage.js` changes at runtime. Public method
signatures, stored URL format, existing files and dependencies are unchanged.
No file registry, compatibility wrapper or automatic database-write retry is
introduced. Partial cleanup can still leave an owned destination for explicit
reconciliation; it does not justify deleting an unrelated existing object.

Ten new adapter tests cover concurrent buffer/path uploads with original/custom
names, payload identity, deletion isolation, dangling links, missing sources,
partial writes, cleanup failures, source-removal failures and inspection errors.
The concurrent cases force all three filename checks to complete before any
upload writes. Five of the initial nine adapter cases fail on the old source;
the other four are controls. Four new managed rollback tests also fail on the
old adapter: the previously committed file is missing after rollback. Corrected
JSON:API/plain cases preserve its bytes and restored database URL while removing
the failed replacement. The original uninstrumented concurrent-upload probe
also now returns two distinct URLs with both payloads preserved.

The full **Node 24.6.0** `npm run verify` exits zero:

| Gate job | Result | Duration |
| --- | ---: | ---: |
| Ordinary SQLite | 4647/4648; zero failures, one existing skip | 243.548s |
| Canonical SQLite | 4696/4696; no failures/skips | 226.893s |
| Express 4 ordinary | 388/388 | 18.436s |
| Express 4 canonical | 390/390 | 19.860s |

Total: **10,121 passed**, zero failed/cancelled, one existing skip. Types,
both query-budget jobs, full lint and docs pass; the gate's docs build takes
2.807s. The source remains unchanged throughout that gate. Initial formatting
errors in the added integration tests were corrected before the gate began.

The selected native file suite passes **348/348**, without failures, skips or
cancellations, and both runners exit zero:

| Database | Ordinary storage | Canonical storage | Durations |
| --- | ---: | ---: | --- |
| PostgreSQL 16.15 | 89/89 | 89/89 | 25.155s /31.861s |
| MySQL 8.0.46 | 85/85 | 85/85 | 24.536s /42.089s |

The two changed suites pass 98/98 per SQLite mode before the full gate.
Native runs select `conformance-file-failures.test.js`, including the four
new API rollback cases; the standalone filesystem unit suite is not advertised
as separate database coverage. This is not a full native matrix or a fresh
Redis/consumer result. Native server PIDs and disposable directories are removed.

Local commands/evidence:

- All Node/npm commands use `/home/merc/.nvm/versions/node/v24.6.0/bin` on `PATH`.
- `npm run verify` → `/tmp/library-local-allocation-gate.log`.
- `JSON_REST_API_STORAGE=<knex|anyapi> node --test tests/local-storage.test.js tests/conformance-file-failures.test.js`
  → `/tmp/library-local-allocation-{knex,anyapi}.log`.
- `node scripts/test-databases.js <pg|mysql2> tests/conformance-file-failures.test.js`
  → `/tmp/library-local-allocation-{pg,mysql2}.log`, using the recorded native binaries.
- Before-fix adapter and managed cases:
  `/tmp/library-local-allocation-before.log` and
  `/tmp/library-local-allocation-managed-before.log`.
- Natural race probes: `/tmp/library-local-storage-concurrent-probe.log`
  and `/tmp/library-local-allocation-natural.log`.
- Prior-source backup: `/tmp/library-local-allocation-start-qp6lfbq5`;
  its test source was restored after the isolated before-fix replay and all
  273 prior source hashes match again. Current tested source hashes:
  `/tmp/library-local-allocation-source.json`; final audit:
  `/tmp/library-local-allocation-audit.json`.

File and migration guides now describe exclusive allocation, temporary-source
handling and cleanup error evidence. The final docs rebuild and rendered-page
checks pass. Dependency and parked consumer patch hashes are unchanged.

**Remaining ownership evidence:** a real shared-file probe stores the same URL
on two documents, deletes one document, and verifies the other row and bytes
remain valid. This is accepted current API behavior, not a hypothetical use.
`/tmp/library-shared-file-lifetime-probe.log` records the result and its fixture
and directory were closed/removed. Automatically deleting an old URL merely
because one field changes would violate those shared references. The remaining
A7-09 decision and tests must address ownership explicitly; this checkpoint
does not settle them or claim automatic old-file cleanup is complete.

## 2026-09-10: Completion order and finalizer failures

**97/214 complete (45.3%); 117 open.** Categories are A74/138,
B21/48, M2/14 and C0/14. **B2-05 is complete.** The broader A7 failure
audit, file allocation/ownership and consumer migration remain open. Consumer,
seed and positioning work remains paused.

**A7-F09 corrected:** `finishTransaction` previously let a rejected internal
finalizer escape its loop. Later finalizers were skipped, and a finalizer error
could replace the first after-commit hook failure. The existing shared helper
now applies the same first/secondary error rule to both completion chains and
finalizers, attempts all finalizers, and indexes secondary finalizer errors with
`{ phase: 'finalization', finalizerIndex, error }`. Rollback and unknown outcomes
retain their original failure; finalizers cannot turn them into a commit or
trigger outcome hooks. No new public method, transaction wrapper or compatibility
path is introduced. Only `lib/error-context.js` changes at runtime.

Four new finalizer regressions fail on the previous runtime: three stop after
the first finalizer and one also observes replacement of the earlier hook error.
The two overlapping-write ordering controls already pass there. On the corrected
runtime, nine new managed tests cover those cases, deliberate null/undefined
finalizer failures, and diagnostic collection after unknown completion without
outcome hooks. Registration uses the existing internal finalizer helper while
database writes and transaction completion use the public managed API.
Two new real Socket.IO tests, one per transport, force the first enlisted write
to pause until the second finishes. Notifications follow capture order while
completion hooks retain enlistment order. Promise barriers establish the order;
there are no timing sleeps in those tests.

The source audit reconciles the in-repository completion producers:

| Producer | Completion rule and evidence |
| --- | --- |
| Resource/relationship operations, including nested resource writes | One accepted hook chain per operation; commit in enlistment order, rollback in reverse. Existing lifecycle/mixed-operation tests and new overlapping-write controls verify timing and counts. |
| File uploads | Existing per-operation outcome hooks clean after confirmed rollback and release tracking after confirmed commit. B2-09's actual-file tests verify multiple uploads, repeated records and completion-hook failures. |
| Socket.IO | Finish hooks capture changes; the first successful commit chain drains the transaction queue in capture order. Rollback drops it. Real-client tests verify pending silence, exact counts, visibility, overlapping writes and failed chains. |
| Bulk diagnostics | The existing registration helper schedules final collection after outcome hooks. Finalizers run in registration order and now survive an earlier finalizer failure. Bulk/file suites verify retained child diagnostics and uploads without duplicate cleanup. |

The only runtime commit/rollback calls are in the shared completion helper.
Registry writes use it without adding synthetic resource hooks. Hook-local
stop-on-error behavior remains documented; later operations' chains are still
attempted. These checks do not claim durable/exactly-once delivery or automatic
cleanup when every applicable plugin hook is interrupted.

The full **Node 24.6.0** `npm run verify` exits zero:

| Gate job | Result | Duration |
| --- | ---: | ---: |
| Ordinary SQLite | 4633/4634; zero failures, one existing skip | 114.500s |
| Canonical SQLite | 4682/4682; no failures/skips | 211.224s |
| Express 4 ordinary | 388/388 | 30.988s |
| Express 4 canonical | 390/390 | 41.730s |

That is **10,093 passed**, zero failed/cancelled, and one existing skip across
the four test jobs. Types, both query-budget jobs, full lint and docs pass too;
the gate's docs build takes 4.179s. No runtime or test logic changes during the
gate. Two lint directives annotate deliberately thrown non-Error values; a
normalized AST comparison confirms those comments leave the tested program
unchanged. Final full lint checks that source.

Six selected native suites also exit zero: **1,646/1,646**, without failures,
skips or cancellations.

| Database | Ordinary storage | Canonical storage | Durations |
| --- | ---: | ---: | --- |
| PostgreSQL 16.15 | 419/419 | 419/419 | 36.139s /81.386s |
| MySQL 8.0.46 | 404/404 | 404/404 | 64.637s /94.219s |

The selected suites are managed transactions, file failures, bulk failures,
transaction context, write failures and Socket.IO authorization. The two changed
suites additionally pass 129/129 per SQLite mode before the full gate. This is
selected native coverage, not a full native matrix or new Redis/consumer result.
Both disposable database directories and server PIDs are removed.

Commands and local evidence:

- All Node/npm commands use `/home/merc/.nvm/versions/node/v24.6.0/bin` on `PATH`.
- `npm run verify` → `/tmp/library-completion-order-gate.log`.
- `node scripts/test-databases.js <pg|mysql2> tests/conformance-managed-transactions.test.js tests/conformance-file-failures.test.js tests/conformance-bulk-failures.test.js tests/conformance-transaction-context.test.js tests/conformance-write-failures.test.js tests/conformance-socketio-authorization.test.js`
  → `/tmp/library-completion-order-{pg,mysql2}.log`, using the recorded disposable native binaries.
- Before-fix six-case selection: `/tmp/library-completion-order-before.log`;
  focused passing selection: `/tmp/library-completion-order-final-focused-{knex,anyapi}.log`.
- Backup: `/tmp/library-completion-order-start-0qxu92ak`;
  tested source hashes: `/tmp/library-completion-order-source.json`;
  final source hashes: `/tmp/library-completion-order-complete-source.json`;
  AST comparison: `/tmp/library-completion-order-comment-audit.json`;
  final audit: `/tmp/library-completion-order-audit.json`.

Managed-transaction, outcome, Socket.IO and migration documentation describes
the observed ordering and diagnostic phases. The final docs rebuild and rendered
page/anchor checks pass. Dependency and parked consumer patch hashes are unchanged.

**Next verified defect, still open (A7-F10):** an actual concurrent LocalStorage
probe using `nameStrategy: 'original'` and two `shared.txt` uploads returned
`/uploads/shared.txt` twice. The final file contained only the second payload.
The adapter checks uniqueness before a non-exclusive write, so allocation races
can overwrite another upload. `/tmp/library-local-storage-concurrent-probe.log`
records the reproduction. Its temporary directory was removed. No adapter fix
is included in this checkpoint; A7-09 explicitly retains that work.

## 2026-09-10: Managed files and notifications

**96/214 complete (44.9%); 118 open.** Categories are A74/138,
B20/48, M2/14 and C0/14. **B2-09 is complete.** This batch adds 34
cases in two existing suites and changes no runtime, fixture, dependency or
consumer code. Consumer migration remains paused. B2-05's broader completion
ordering audit, A7's remaining guarantees and obsolete-file removal remain open.

The eighteen new file cases run in JSON:API and plain formats. Actual temporary
and stored files establish that repeated uploads to new or existing records
remain tracked while the callback is pending. Commit releases their tracking;
callback rejection or a caught participating-write failure rolls the unit back
and deletes new uploads in reverse operation order. Earlier committed files
survive. A replacement/replacement/delete rollback restores the original row
and URLs, retains the one file whose deletion fails, and still deletes the
other new files. Its cleanup diagnostics and unresolved upload remain on the
operation context. Failed completion hooks preserve the primary error and
indexed secondary errors while later operations' completion chains still run.

Sixteen new Socket.IO cases use connected WebSocket and polling clients with
acknowledgement barriers, not sleep-based assertions. A six-operation callback
includes create/update/delete of one record, two updates of another, and a
hidden record. No notice or completion hook runs while the callback is pending.
A gated completion hook establishes that the database has committed but the
helper is still awaiting delivery. Releasing the gate produces exactly the
five visible invalidations in order, without coalescing the transient record's
three operations. Callback, caught-write and caught-SQL failures produce no
notifications and restore database state, including when rollback hooks fail.
The next independent transaction emits only its own notice. When the first
after-commit chain fails before delivery, a later chain flushes the queue once;
the first failure remains primary and the later failure is indexed secondary
evidence. The committed row remains committed.

All selected **Node 24.6.0** jobs exit zero, with no failures, skips or
cancellations: **1,258/1,258** test executions.

| Selection | Ordinary storage | Canonical storage | Durations |
| --- | ---: | ---: | --- |
| SQLite, five files | 287/287 | 287/287 | 24.451s /25.997s |
| PostgreSQL 16.15, two files | 173/173 | 173/173 | 53.633s /43.483s |
| MySQL 8.0.46, two files | 169/169 | 169/169 | 48.038s /48.350s |

SQLite includes the two changed suites, managed transactions, transaction
context and Socket.IO contracts. Native runs select the two changed suites;
this is not a complete native matrix or a SQL/Redis cross-product. No new Redis
or consumer verification is claimed. The preceding full Node 24 gate remains
the latest full gate; the runtime is unchanged since that checkpoint. Initial
isolated file/socket checks also passed. Initial lint found nine formatting
errors in the new tests; ESLint corrected those formatting/declaration-layout
issues after the behavioral runs, and full lint then passed.

Commands and retained local evidence:

- `JSON_REST_API_STORAGE=<knex|anyapi> node --test tests/conformance-file-failures.test.js tests/conformance-socketio-authorization.test.js tests/conformance-managed-transactions.test.js tests/conformance-transaction-context.test.js tests/socketio-contract.test.js`
- `node scripts/test-databases.js <pg|mysql2> tests/conformance-file-failures.test.js tests/conformance-socketio-authorization.test.js`
- All commands use Node 24 via `/home/merc/.nvm/versions/node/v24.6.0/bin`;
  native runners use the disposable database binaries recorded in earlier entries.
- Logs: `/tmp/library-managed-side-effects-{knex,anyapi,pg,mysql2}.log`;
  `/tmp/library-managed-side-effects-final-lint.log` and
  `/tmp/library-managed-side-effects-docs.log`.
- Backup: `/tmp/library-managed-side-effects-start-vzm8t57c`;
  source hashes: `/tmp/library-managed-side-effects-source.json`;
  parsed results: `/tmp/library-managed-side-effects-results.json`;
  final audit: `/tmp/library-managed-side-effects-audit.json`.

The file, Socket.IO and managed-transaction guides now describe these tested
paths and distinguish obsolete-file retention, per-operation invalidations and
unfinished broader audits. Documentation rebuild and rendered-page checks pass.
Both disposable native database directories and their server PIDs are removed.
The dependency graph and parked consumer patch hashes are unchanged.

## 2026-09-10: Managed caller migration and full gate

**95/214 complete (44.4%); 119 open.** Categories are A74/138,
B19/48, M2/14 and C0/14. **A7-02 is complete:** the failure-phase map below
reconciles the existing tests against the managed contract, now passing the
full gate. This does not close the broader A7 guarantees, B2 file/event
integration or consumer migration. Consumer, seed and positioning work remains
paused; no consumer verification was run.

Forty-two raw transaction setups across 26 test files now use the existing
`holdManagedTransaction` test helper. It receives an actual Knex handle and
settles the owner's callback for rollback. One temporal-registry callback also
uses `api.transaction`; a caught rejected write must still reject the outer
unit. Read-only API, direct SQL, low-level storage/locking, schema/data migration
and rejected-raw/savepoint controls retain their documented raw transaction
contracts. The runtime itself is unchanged in this batch.

Assertions retain pending visibility, rollback restoration, permissions, exact
IDs, query/binding/row bounds and original failures. Unit error-handler tests now
enlist their fake transaction's completion chain through the shared owner.
Socket.IO tests distinguish enlisted resource hook chains from database commit
counts: relationship replacement includes its nested PATCH, and reverse updates
include child PATCH chains. The existing notification assertions still require
exactly the expected parent/child events. Bulk cleanup assertions now require
the indexed operation metadata introduced by managed completion.

The source audit also found a raw library-write transaction in
`scripts/measure-query-plans.js`. Its old version fails with the expected
transaction validation error. Its mutation workloads now use the same held
managed callback, preserving rollback of fixture changes. This standalone
benchmark was migrated after the full gate began; no library runtime or test
changed during that gate. The benchmark is verified separately below.

The initial diagnostic was stopped after an old cleanup path leaked a test-held
connection following raw-write rejection. Its recorded 4325 passes, 177 failures,
one cancellation and one skip are incomplete evidence, not a full gate. The
first actual `npm run verify` then reached **4586/4589** ordinary tests, with two
failures and one existing skip. Both failures shared one missed pivot-test
transaction setup. After migrating it, that suite passes 20/20 per invocation.
The first native selections were stopped and cleaned up when that missed caller
was identified; their partial results are superseded by the complete runs below.

The final **Node 24.6.0** `npm run verify` exits zero:

| Job | Result | Duration |
| --- | --- | ---: |
| Full ordinary SQLite | 4588/4589 passed; zero failures, one existing skip | 172.561s |
| Full canonical SQLite | 4637/4637 passed; no failures/skips | 166.167s |
| Express 4 ordinary | 370/370 passed | 20.584s |
| Express 4 canonical | 372/372 passed | 23.717s |

Configured type checking, full lint, both 44-workload query budgets and docs pass.
The gate's docs build takes 4.738s. No failed or cancelled test is counted as
verification success. The single ordinary skip is the existing backend-specific
case, not a newly skipped managed-transaction test.

The 28-file native selection passes **5334/5334**, without failures, skips or
cancellations; both runners exit zero:

| Database | Ordinary invocation | Canonical invocation | Durations |
| --- | ---: | ---: | --- |
| PostgreSQL 16.15 | 1332/1332 | 1332/1332 | 327.983s /191.689s |
| MySQL 8.0.46 | 1335/1335 | 1335/1335 | 428.252s /229.200s |

The selection contains the 26 migrated transaction-test files plus temporal
migration and Socket.IO authorization. Its exact file list is recorded below.
Backend-fixed suites remain fixed under either invocation; this is not the full
native matrix or a SQL/Redis cross-product. No fresh Redis result is claimed.

The query-plan script also exits zero in all six SQLite/PostgreSQL/MySQL storage
jobs. Each produces 22 reports: eleven scenarios before and after candidate
indexes, **132 executed reports** in total. Native Node test wrappers report one
passing script per mode; those wrappers are not 22 separate tests. Scenario
assertions verify results and explainable SQL. Historical plan reports span
intervening optimizations and differ in statement counts; this does not establish
a performance change caused solely by this caller migration.

The A7-02 acceptance map uses the unchanged runtime's preceding
[5,062-check ownership matrix](#2026-09-10-managed-ownership-registry-and-concurrency)
together with the current full gate and migrated native tests:

| Required failure phase | Executed evidence |
| --- | --- |
| Preparation | `conformance-lifecycle`: before-processing and schema-validation stage injection; later-stage suppression and stored-state assertions |
| Authorization | Lifecycle permission stages, `conformance-authorization`, related permissions and batched target validation |
| Setters | Lifecycle setter injection and `conformance-field-callback-failures` across POST, PUT-create/update and PATCH |
| Main writes | `conformance-transactions`: actual SQLite busy-write rejection and native deadlock/lock-conflict cases, owner rollback and persisted-state checks |
| Relationship writes | Reverse-child rejection, late pivot/link insertion/deletion/read failures and rollback restoration across the migrated relationship suites |
| Finish/enrichment | Lifecycle finish/enrich stages plus included field, projection and post-write refresh failures |
| Commit | `conformance-write-failures` and `conformance-managed-transactions`: rejected control statements, lost acknowledgments, confirmed PostgreSQL rollback and post-commit hook failures |

This proves coverage of the named phases. It does not promise every extension
preserves arbitrary thrown values, establish real network-partition guarantees,
or finish replacement/deletion of old uploaded files. Those retain their open
items; failure coverage alone does not certify all failure handling correct.

The API reference, initial setup, bulk, Socket.IO and migration guides now use
the selected transaction ownership. Seven transaction code blocks pass syntax
checking; this is not consumer/example execution. Broader documentation
reconciliation and actual migrated consumer examples remain open. No API alias,
runtime compatibility layer, dependency change or consumer edit was added.

Evidence files:

- `/tmp/library-managed-callers-start-path` and source backup
  `/tmp/library-managed-callers-start-wkfmnc4_`.
- `/tmp/library-managed-callers-before.log`,
  `/tmp/library-managed-callers-gate.log`,
  `/tmp/library-managed-callers-{pg,mysql}.log` (superseded runs).
- `/tmp/library-managed-callers-final-{gate,pg,mysql}.log`.
- `/tmp/library-managed-callers-native-files.txt` (28 selected files).
- `/tmp/library-managed-callers-plan-before.log` and
  `/tmp/library-managed-callers-plan-{knex,anyapi,pg,mysql}.log`.
- `/tmp/library-managed-callers-final-source.json` (gate runtime/tests),
  `/tmp/library-managed-callers-complete-source.json` (including the separately
  verified benchmark), `/tmp/library-managed-callers-final-inventory.txt`.
- `/tmp/library-managed-callers-doc-examples.json`,
  `/tmp/library-managed-callers-docs.log`,
  `/tmp/library-managed-callers-audit.json`.

## 2026-09-10: Managed ownership, registry and concurrency

**94/214 complete (43.9%); 120 open.** Categories are A73/138,
B19/48, M2/14 and C0/14. This checkpoint closes **B2-03/B2-04/B2-06/B2-08**:
callback execution/result propagation, shared participation, explicit nesting
and the specified mixed-operation/failure checks. B2-01/B2-05/B2-07/B2-09/B2-10,
the broader A7 audit and the full gate remain open. Consumer, seed and
positioning work remains paused.

The canonical `addKnexFields()` batch was still creating a raw Knex transaction
around registry writes. It now calls `api.transaction()`; the registry already
uses the shared ownership mechanism. Runtime inspection finds remaining raw
creators only at transaction factories and schema-only DDL boundaries. Those
schema/data migration and read-only contracts remain separate. Deep registry
writes require managed handles; their callers still invalidate descriptor caches
after confirmed commit and explicitly refresh published resource metadata.

Registry, field-evolution, descriptor-transaction, concurrency and write-failure
tests now use the selected callback contract for library writes. Raw read-only,
DDL and rejected-savepoint controls remain. A small test helper holds the actual
managed callback open while independent connections coordinate; its commit and
rollback controls settle that callback, without replacing Knex completion.
The tests retain visibility, tenant isolation, metadata/cache publication,
repeatable-read, native lock/deadlock and original/secondary failure assertions.
A new nested-callback case proves each helper call starts an independent
top-level unit: inner committed work survives outer rollback. One shared unit
is composed by forwarding its handle; child-savepoint library writes reject.

**A7-F08 corrected:** mutable `context.shouldCommit` could make a participant
enter the owner's rollback path. That path waited for the owner, which was
waiting for the participant: a deadlock. The new participant regression hung
in both SQLite modes before the guard; its processes were inspected and then
terminated. These were incomplete runs, not passing or completed failing suites.
Rollback now rejects participant ownership, and implicit commit/rollback
decisions use the private owner record. Four regressions cover a participant
setting the flag and an implicit owner having it cleared, on success and failure.
The diagnostic flag cannot transfer or suppress completion. Arbitrary concurrent
mutation of enlisted contexts remains outside the supported contract.

The initial migrated write-failure tests also exposed an assertion distinction:
failed operations retain their own original error during rollback; operations
that succeeded before the unit failed receive the owner's error, which can be
a write-error wrapper. The final assertions check these exact identities and
indexed secondary diagnostics instead of assuming every context has one cause.

The frozen 11-file **Node 24.6.0** selection passes **5062/5062**, without
failures, skips or cancellations. All six jobs exit zero:

| Database | Ordinary invocation | Canonical invocation | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 837/837 | 837/837 | 23.159s /25.588s |
| PostgreSQL 16.15 | 856/856 | 856/856 | 48.117s /39.004s |
| MySQL 8.0.46 | 838/838 | 838/838 | 52.691s /51.032s |

The files are `conformance-managed-transactions`, `conformance-lifecycle`,
`conformance-transaction-context`, `conformance-file-failures`,
`conformance-bulk-failures`, `conformance-write-failures`,
`conformance-transactions`, `anyapi-registry-failures`, `anyapi-field-evolution`,
`anyapi-descriptor-transactions` and `anyapi-descriptor-failures` (all `.test.js`
under `tests/`). Canonical-specific files remain canonical under either invocation.
This includes real Express/Fastify descriptor cases, not a full connector matrix.
Driver failure tests inject rejected control statements and lost acknowledgments
after actual execution; they do not simulate an actual network partition.
Full lint and the configured type check also exit zero.

Before migration, the registry suite passed 55/64 and field evolution 5/18.
The old write-failure run timed out with stale raw-owner cleanup; its partial
counts are not gate evidence. The initial migrated version passed 123/125 per
mode before correcting the two error-identity assertions above. Subsequent
registry/concurrency/failure native runs passed; the final table supersedes those
earlier selected runs for the current source, including the ownership correction.

The master, managed contract, outcome guide and API migration guide describe this
boundary. The full ordinary/canonical/connector/query-budget gate has **not** been
rerun since managed implementation began. Other raw-write tests still require
migration, and managed multi-upload/replacement, repeated-resource Socket.IO
events, remaining public documentation/types and consumer examples remain open.
No fresh Redis run or consumer verification is claimed.

Evidence files:

- `/tmp/library-managed-registry-start-path` and its source backup.
- `/tmp/library-managed-registry-before.log`,
  `/tmp/library-managed-evolution-before.log`,
  `/tmp/library-managed-write-failures-before.log` and
  `/tmp/library-managed-write-failures-{knex,anyapi}.log`.
- `/tmp/library-managed-ownership-before-{knex,anyapi}.log` and
  `/tmp/library-managed-ownership-before-processes.txt`.
- `/tmp/library-managed-owner-{knex,anyapi,pg,mysql}.log`.
- `/tmp/library-managed-owner-{lint,types,docs}.log`.
- `/tmp/library-managed-owner-source.json` (273 source hashes) and
  `/tmp/library-managed-owner-audit.json`.

## 2026-09-10: Managed transaction implementation in progress

**90/214 complete (42.1%); 124 open.** Categories remain A73/138,
B15/48, M2/14 and C0/14. No implementation checkbox is closed by this
checkpoint. The previous full gate describes the preceding source, not this
unfinished breaking change. Consumer, seed and positioning work remains paused.

The working tree now implements `api.transaction(callback, context?)` using
one completion owner for resource, relationship, bulk and registry writes.
The callback receives an actual Knex transaction and returns its value unchanged
after awaited completion hooks. Participating writes enlist their existing hook
chains without dispatching them early. Raw transactions/savepoints passed to
library writes reject; raw SQL and read-only uses remain available. Caught
participating write/observed SQL failures abort the unit. Completion releases
enlisted contexts, including after unknown outcomes, and preserves original
failures plus indexed secondary diagnostics. No runtime legacy mode was added.

The new 26-case managed suite exercises callback values/rejections, mixed
writes/relationships/bulk/raw SQL, failed-unit propagation, context reuse,
completion order and failures, savepoint rejection, manual completion and
in-flight writes. Driver interception rejects control SQL or injects a lost
acknowledgement after actual execution; it is not a real network-partition test.

Existing lifecycle, context-reuse, bulk-failure and file-failure suites now use
the selected callback contract. Lifecycle tests retain exact awaited traces,
field/response/context assertions and failure injection at every existing stage.
Bulk tests still inspect pending rows/linkage through a separate connection,
check actual outer commit/rollback, and now require completion hooks in order.
Factory savepoints reject before upload processing; direct tests leave those
unprocessed input files with their caller. Earlier completed uploads survive
subsequent context reuse failures in both implicit and callback-owned writes.

The initial file/bulk diagnostic reports **85/116 passes, 31 failures per mode**:
raw-transaction expectations, savepoint timing and newly indexed hook diagnostics
needed migration. After that migration, **98/116 pass**. The remaining 18 cases
exposed a real implementation gap: completion updated resource participants but
left accepted bulk contexts without their final outcome. Finalization now sets
the observed outcome on every accepted context before dispatching resource hooks;
it still does not create a synthetic bulk hook chain.

The frozen Node 24.6.0 five-file check passes **3164/3164** across both storage
modes and all three databases, without failures, skips or cancellations:

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 526/526 | 526/526 | 11.151s /11.620s |
| PostgreSQL 16.15 | 530/530 | 530/530 | 12.477s /19.123s |
| MySQL 8.0.46 | 526/526 | 526/526 | 18.857s /21.128s |

The extra PostgreSQL cases exercise its COMMIT-as-ROLLBACK response with uploaded
files. All commands exit zero. Full lint and type checking also pass. These are
the five selected suites, not the full library or native matrix.

Remaining work includes registry and other raw-transaction test migration,
concurrency/isolation cases, managed multi-upload/replacement and Socket.IO
integration, the broader failure audit, final public docs/examples/types and
consumer migration. The full ordinary/canonical/connector/query-budget gate
has not been rerun for this unfinished implementation. No fresh Redis result
or full native matrix is claimed.

Evidence files:

- `/tmp/library-managed-start-path` and `/tmp/library-managed-start-rghsa96p`.
- `/tmp/library-managed-file-bulk-diagnostic-{knex,anyapi}.log` and
  `/tmp/library-managed-file-bulk-second-{knex,anyapi}.log`.
- `/tmp/library-managed-progress-{knex,anyapi,pg,mysql}.log`.
- `/tmp/library-managed-progress-final-lint.log`,
  `/tmp/library-managed-progress-final-types.log`.
- `/tmp/library-managed-progress-source.json` (273 source hashes).
- `/tmp/library-managed-progress-docs.log` and
  `/tmp/library-managed-progress-audit.json`.


## 2026-09-10: Owned savepoints and managed transaction contract

**90/214 complete (42.1%); 124 open.** Internal work is 73/138, API work
15/48, migration 2/14 and final review/report 0/14. **B1-03 is complete:**
write outcomes are populated from observed transaction evidence. **B2-02 is
complete as a specification only:** `api.transaction(callback, context?)` is
the selected target, not an implemented method. B1-02/B1-04/B1-05 still require
consumer migration; the broader A7 failure audit and B2 implementation remain
open. Consumer, seed and positioning work remains paused.

The ownership audit found **A7-F07**. Knex savepoint `commit()` releases the
savepoint while its parent remains pending. The outcome helper recognized that
as pending, but its caller then set `transactionCommitted` and ran `afterCommit`;
registry writes could also publish metadata before outer commit. Merely changing
the error's string outcome did not make those side effects safe.

The existing shared commit helper now requires a top-level transaction. A
custom factory's savepoint rejects with a validation cause before release, then
follows existing rollback handling. Confirmed child rollback reports rolledBack,
preserves unrelated outer work and permits uploaded-file cleanup. It never
completes the parent or runs commit hooks/cache publication. The helper no longer
needs the savepoint-pending branch. This is one net runtime line in one existing
module, not a transaction manager or compatibility path. All six owned commit
sites already use it. Explicit raw borrowed savepoints retain caller ownership
in the current worktree; their eventual migration is specified separately.

Eighteen new tests cover eight resource/relationship operations, three atomic
bulk methods, three canonical registry writes, two actual-file cleanup cases
and two borrowed-savepoint controls. They check rows/linkage after committing
unrelated parent work, parent/child completion, hook counts, cache contents and
the presence/removal of uploaded and temporary files. The registry cases remain
canonical regardless of invocation mode.

An isolated copy containing the new tests and previous runtime reports
**2/18 passes, 16 failures** in each storage invocation, without skips or
cancellations (1.668s /1.786s). The two borrowed-savepoint controls already pass;
all sixteen owned-completion cases fail. Initial focused old-runtime runs had
already reproduced the eleven resource/bulk and three registry failures. No
fixture or assertion corrections were needed after these reproductions.

Patched write/registry suites pass **189/189 per mode** (4.774s /5.564s), and
the ordinary file-failure suite passes **63/63** (1.283s). Targeted lint passes.
The frozen **Node 24.6.0** `npm run verify` then exits zero:

| Job | Passed | Duration |
| --- | ---: | ---: |
| Full ordinary SQLite | 4557/4558; one existing skip, no failures | 101.691s |
| Full canonical SQLite | 4606/4606; no failures/skips | 105.957s |
| Express 4 ordinary | 370/370 | 16.256s |
| Express 4 canonical | 372/372 | 12.581s |

Type checking, lint, docs and both 44-workload query budgets pass. Every budget
counter and ceiling matches the preceding checkpoint; only informational elapsed
time and heap samples are excluded. That gate's docs build takes 3.555s.

The six-file native runner exits zero with **2494/2494**, no failures, skips
or cancellations. It includes write/registry/bulk/file failures, real Socket.IO
authorization and concurrent transaction cases:

| Database | Ordinary invocation | Canonical invocation | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 409/409 | 409/409 | 16.372s /38.876s |
| PostgreSQL 16.15 | 428/428 | 428/428 | 54.502s /62.596s |
| MySQL 8.0.46 | 410/410 | 410/410 | 76.915s /55.650s |

No fresh full native matrix or SQL/Redis cross-product is claimed. Redis was not
repeated for this guard in the shared completion helper; the previous 92-case
run remains historical evidence. Simulated lost acknowledgments and rejected
control SQL support the tested uncertainty paths; they are not real network
partition tests. Those broader A7 guarantees remain open.

Together with the previous carrier/driver evidence, this closes B1-03: none and
pending follow acceptance/ownership; committed requires top-level completion;
rolledBack requires observed confirmation; failed/ambiguous completion remains
unknown. It does not declare every extension catch or consumer error path done.

The [managed transaction specification](../GUIDE/managed-transactions.md) defines one
callback owner, real Knex participation, unchanged callback results, failed-unit
propagation and ordered completion hooks. It deliberately replaces unmanaged
raw transactions passed to library writes, while keeping raw SQL inside the
managed callback. It specifies context ownership, secondary diagnostics,
explicit nesting limits and migration of jskit-ai's captured transaction wrapper.
Implementation, library-test migration and actual consumer integration remain
future work; no second transaction engine or runtime translator was introduced.

All 272 frozen source hashes match. Only the error-context runtime module and
three existing test files differ from the previous manifest. Package, lockfile,
dependency graph and parked consumer patch remain unchanged; the disposable
database directory is removed. The migration and outcome guides distinguish
the implemented savepoint guard from the unimplemented managed API.

Evidence files:

- `/tmp/library-nesting-start-path`, `/tmp/library-nesting-baseline-path`.
- `/tmp/library-nesting-final-before-knex.log`,
  `/tmp/library-nesting-final-before-anyapi.log`.
- `/tmp/library-nesting-focused-knex.log`,
  `/tmp/library-nesting-focused-anyapi.log`,
  `/tmp/library-nesting-files-focused.log`.
- `/tmp/library-nesting-final-gate.log`,
  `/tmp/library-nesting-final-native.log`.
- `/tmp/library-nesting-final-source.json`,
  `/tmp/library-nesting-final-audit.json`,
  `/tmp/library-nesting-final-docs.log`.

## 2026-09-10: Write-error outcomes and retry guidance

**88/214 complete (41.1%); 126 open.** Internal work is 73/138, API work
13/48, migration 2/14 and final review/report 0/14. **B1-06 and B1-07 are
complete:** the specified failure tests and retry guidance. B1-02 through B1-05
remain open for the remaining ownership/evidence audit and paused consumer
migration. Managed completion remains B2. Consumer, seed and positioning work
remains paused.

The existing error module now exports `RestApiWriteError`. Each rejected write
gets its own immutable `transactionOutcome`, original `cause` and copied
classification data. A shared boundary in the existing error-context module
resets operation state and catches early validation as well as method failures.
Resource/relationship and bulk registrations use that boundary; canonical
registry writes use the same carrier with local context. No runtime module,
dependency or compatibility option is added. Read errors retain their contract.

Existing completion helpers populate the context from the observed transaction
evidence. Tests distinguish confirmed commit/rollback, pending borrowed work,
no transaction and uncertain completion. A child error can retain pending while
its owning atomic batch reports rolledBack. Later context reuse or completion
does not mutate a previously returned error. Secondary cleanup/logging failures
remain diagnostics and do not replace the primary cause.

HTTP mapping adds `meta.transactionOutcome` to each JSON:API write error and
non-atomic bulk entries include `error.transactionOutcome`. Connector failures
before transaction setup report none, while a response-hook failure after
commit reports committed. Static rejection/negotiation responses also carry
the outcome. HTTP status mapping remains intact. Socket.IO exposes subscription
acknowledgments, not write acknowledgments; no socket runtime change was needed.

The failure suites now assert the outer write class, preserved cause and outcome
alongside their existing row/linkage, hook, cache, upload and ownership checks.
Thirty-five new cases cover immutable snapshots, early context reset, nested
causes, inherited status fields, HTTP pre-write rejection and post-commit
response-hook failure. Existing tests also cover commit/rollback rejection,
failed completion SQL, simulated lost acknowledgments, frozen/primitive causes,
secondary cleanup and borrowed transactions. Null throws already lost inside
the installed hook dispatcher's catch remain an independent boundary; the new
wrapper cannot restore a cause discarded before reaching it.

The first broad assertion-migration run reported 402 old-contract failures. The
selected migrated files then exposed four remaining DataCloneError-name checks,
which now inspect the cause. Focused HTTP checks found a real carrier regression:
Express's oversized-body error inherits its 413 status. Copying only own fields
changed it to 500. The wrapper now reads data descriptors through the prototype
chain without invoking diagnostic getters. Fixture corrections for required
IDs, a successful reused context and explicit JSON:API reads are recorded in the
retained intermediate logs; those were test mistakes, not runtime defects.

The candidate `npm run verify` passes type checking, both 44-workload query
budgets and the full ordinary suite. Every budget counter and ceiling matches
the prior baseline, excluding only informational elapsed time and heap samples.
Its canonical suite reports **4587/4588**, one failure (148.008s): a canonical-only
relationship batching test still compares the thrown error directly with its
original cause. The assertion now checks the preserved cause and rolledBack,
keeping its actual empty-link/storage assertions. Only that test file changed
after the candidate source freeze; runtime and all native-selected files stayed
identical. The failed and remaining verification stages then exit zero:

| Job | Passed | Duration |
| --- | ---: | ---: |
| Full ordinary SQLite, candidate | 4539/4540; one existing skip, no failures | 123.665s |
| Full canonical SQLite, corrected assertion | 4588/4588; no failures/skips | 104.668s |
| Express 4 ordinary | 370/370 | 12.458s |
| Express 4 canonical | 372/372 | 14.069s |

Lint and documentation build pass (2.825s for that build). Together with the
candidate's passing type/budget/ordinary stages, all required library gate
stages pass; the initial failed invocation is not described as a pass.
All verification in this batch uses **Node 24.6.0**.

The nine-file native runner exits zero with **6226/6226**, no failures,
skips or cancellations. It executes write/registry/bulk/file failures,
Socket.IO authorization, concurrent transactions, lifecycle traces, field
callbacks and post-write refresh failures.

| Database | Ordinary invocation | Canonical invocation | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 1031/1031 | 1031/1031 | 34.156s /60.200s |
| PostgreSQL 16.15 | 1050/1050 | 1050/1050 | 108.700s /126.959s |
| MySQL 8.0.46 | 1032/1032 | 1032/1032 | 74.104s /78.691s |

PostgreSQL-only cases and non-SQLite concurrency explain the count differences;
canonical registry fixtures retain that storage selection in either invocation.
These are selected suites, not a fresh full native matrix. Real Redis 7.0.15
also passes **92/92**, 46 in each storage mode (11.743s /15.320s), using SQLite
application storage, Socket.IO 4.8.1 and adapter 8.3.0. This does not establish a
SQL/Redis cross-product or durable event delivery.

The migration/API/lifecycle/outcome guides explain the carrier, changed
`instanceof`/identity handling, nested causes and retry limits. A generated-ID
POST can commit and then fail notification; replay would create another record.
Unknown completion also does not authorize replay, and even confirmed rollback
cannot undo external effects. No automatic retry capability is implied.

The final source manifest records 272 files, with 14 runtime and 26 test/helper
files changed since the preceding A7-F06 checkpoint. Package, lockfile,
dependency graph and parked consumer patch remain unchanged. Both disposable
database directories are removed. Remaining managed ownership/nesting,
connection-loss evidence and consumer/final-package verification are not claimed
complete by these passing failure cases.

Evidence files:

- `/tmp/library-write-outcome-start-path`, identifying the prior-source backup.
- `/tmp/library-write-outcome-migration-full.log`,
  `/tmp/library-write-outcome-migrated-knex.log`,
  `/tmp/library-write-outcome-migrated-anyapi.log`.
- `/tmp/library-write-outcome-http-focused.log`,
  `/tmp/library-write-outcome-http-second.log`,
  `/tmp/library-write-outcome-http-third.log`.
- `/tmp/library-write-outcome-candidate-gate.log`,
  `/tmp/library-write-outcome-final-recovery.log`.
- `/tmp/library-write-outcome-candidate-native.log`,
  `/tmp/library-write-outcome-candidate-redis.log`.
- `/tmp/library-write-outcome-candidate-source.json`,
  `/tmp/library-write-outcome-final-source.json`,
  `/tmp/library-write-outcome-final-audit.json`,
  `/tmp/library-write-outcome-final-docs.log`.

## 2026-09-10: PostgreSQL rollback acknowledged at commit

**86/214 complete (40.2%); 128 open.** Internal work is 73/138, API work
11/48, migration 2/14 and final review/report 0/14. **A7-F06 is corrected**
within the unfinished transaction work. No additional checklist item is closed;
outcome metadata and managed completion remain open. Consumer, seed and
positioning work remains paused.

A real PostgreSQL 16.15 probe catches an invalid statement inside a transaction,
then commits it. Both Knex promises resolve, `isCompleted()` is true, but the
returned command tag is `ROLLBACK` and the inserted row is absent. The library
previously reported success for this path. This differs from A7-F05: awaiting
`executionPromise` alone cannot detect it.

The existing commit helper now rejects a ROLLBACK response. A private weak set
retains that transaction's confirmed rollback until the existing failure helper
consumes it once. It allows resource rollback hooks and file cleanup without
issuing another ROLLBACK; it prevents commit hooks and registry cache publication.
The runtime change is seven net lines in the existing `lib/error-context.js`.
All six owned commit call sites already use that helper. There is no new public
API or runtime module, and no mutation of the original error to carry evidence.

Eighteen new PostgreSQL cases cover POST, both PUT branches, PATCH, DELETE, three
relationship writes, three atomic bulk methods, three registry operations and
four uploaded-file cases. They check the real command tag, resolved promises,
control-call counts, rows, linkage, completion hooks, cache invalidation and
successful/failed deletion of actual files in both output formats. Atomic bulk
still has no managed outer completion hooks; B2 remains responsible for that.

All **18/18 fail on the old runtime** in the ordinary PostgreSQL invocation
(1.138s), with no skips/cancellations; registry cases explicitly use canonical
storage. The focused patched run passes **18/18 per invocation** (1.144s /1.530s).
Lint then identified three missing block braces in PostgreSQL-only test
registration; those were corrected before the final source freeze.

The six-file native runner exits zero: **2314/2314**, no failures, skips or
cancellations, on Node 24.6.0. It includes write/registry/bulk failures, file
cleanup, real Socket.IO authorization and concurrent transaction suites.

| Database | Ordinary invocation | Canonical invocation | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 379/379 | 379/379 | 12.010s /26.813s |
| PostgreSQL 16.15 | 398/398 | 398/398 | 72.148s /47.176s |
| MySQL 8.0.46 | 380/380 | 380/380 | 45.888s /52.261s |

The eighteen new cases are registered only on PostgreSQL. Registry fixtures
remain canonical in either invocation. The concurrent suite adds one case on
each non-SQLite backend. Redis was not repeated for this backend command-tag
correction; the previous 92-case result remains historical evidence.

The first full verification run passed types and both 44-workload budgets;
every counter and ceiling matches the previous gate, excluding only elapsed
time and heap samples. Its ordinary suite then reported **4492/4505 passes,
12 failures and one existing skip** (85.554s). All twelve failures were Socket.IO
client `xhr poll error` connection failures before any writes ran. The unchanged
suite passes **12/12** alone with polling diagnostics (1.019s). The connection
failure has not been explained. The failed and remaining stages were rerun on
the same frozen source, with client socket diagnostics enabled for the ordinary
suite. That sequence exits zero:

| Job | Passed | Duration |
| --- | ---: | ---: |
| Full ordinary SQLite | 4504/4505; one existing skip, no failures | 79.580s |
| Full canonical SQLite | 4553/4553; no skips/failures | 86.977s |
| Express 4 ordinary | 367/367 | 10.046s |
| Express 4 canonical | 369/369 | 11.356s |

Lint and docs pass; the docs build takes 2.395s. Together with the original
successful type and budget stages, every required library gate passes on this
source. This does not turn the initial failed invocation into a pass or explain
its connection failure. No socket source was changed, no test was skipped to
obtain the later result, and the diagnostic log is retained for investigation.

All **272 frozen source hashes match**. Only the shared runtime helper and four
test/helper files differ from the previous source manifest. Package, lockfile,
dependency graph and parked consumer patch remain unchanged. Disposable database
directories are removed. The migration, lifecycle and outcome guides explain
the correction and its remaining boundaries.

Evidence files:

- `/tmp/library-outcome-start-path`, identifying the saved prior source.
- `/tmp/library-pg-aborted-commit-probe.log`,
  `/tmp/library-aborted-commit-final-before.log`.
- `/tmp/library-aborted-commit-focused.log`,
  `/tmp/library-aborted-commit-final-native.log`.
- `/tmp/library-aborted-commit-final-gate.log`,
  `/tmp/library-aborted-commit-socket-diagnostic.log`,
  `/tmp/library-aborted-commit-final-recovery.log`.
- `/tmp/library-aborted-commit-final-source.json`,
  `/tmp/library-aborted-commit-final-audit.json`,
  `/tmp/library-aborted-commit-final-docs.log`.

## 2026-09-10: Driver completion evidence and outcome vocabulary

**86/214 complete (40.2%); 128 open.** Internal work is 73/138, API work
11/48, migration 2/14 and final review/report 0/14. **B1-01 is complete:**
the [five outcome states](../GUIDE/transaction-outcomes.md) are defined. They are not yet
emitted by the library; the error carrier, population, transport and consumer
migration remain open. **A7-F05 is corrected.** A7/B1/B2 are not declared
complete. Consumer, seed and positioning work remains paused.

Installed Knex 3.1.0 can resolve `commit()` or `rollback()` after their control
query fails, while rejecting `executionPromise`. It also reports `isCompleted()`
true. The existing tests rejected the method itself and therefore missed this
path. A direct SQLite probe replacing COMMIT with invalid SQL reproduces a
resolved method, rejected completion and completed handle.

The existing error-context module now has one small `commitTransaction` function
that awaits both the method and completion promise. The resource helper, three
bulk methods and two canonical registry commit sites use it. The existing
rollback helper also awaits completion before reporting successful rollback.
Rejected commits cannot run after-commit hooks or publish registry metadata;
rollback rejection remains a secondary diagnostic and prevents rollback cleanup
hooks. Original errors and local ownership guards are preserved. This adds six
net runtime lines across four existing modules, without a transaction manager,
public method, API translator or new runtime module.

Forty-four shared cases cover POST, both PUT branches, PATCH, DELETE, three
relationship writes and three atomic bulk methods. Twelve canonical registry
cases cover new/existing registration and field allocation. Each covers invalid
completion SQL and injected acknowledgement loss after actual COMMIT/ROLLBACK.
They inspect the method resolution, completion rejection, error identity, hooks,
cache publication, rows and membership. The new shared test helper restores the
physical connection after deliberately invalid completion SQL; that teardown
is not evidence that application rollback succeeded. A simulated lost response
is not a real network-disconnection test.

The final regression selection fails **56/56 in each storage invocation** on the
old source, with no skips/cancellations (3.080s / 3.385s). The twelve registry
cases explicitly use canonical storage in either invocation. A first draft
omitted required existing PUT fields; that fixture payload was corrected before
this final comparison. The patched five-file focused selection passes
**242/242 per invocation** (6.534s / 7.214s). Three new-test ternary formatting
errors were then corrected; final targeted and full lint pass.

Final **Node 24.6.0** `npm run verify` exits zero:

| Job | Passed | Duration |
| --- | ---: | ---: |
| Full ordinary SQLite | 4504/4505; one existing skip, no failures | 114.642s |
| Full canonical SQLite | 4553/4553; no skips/failures | 129.896s |
| Express 4 ordinary | 367/367 | 15.511s |
| Express 4 canonical | 369/369 | 19.079s |

Types, lint, docs and both 44-workload query budgets pass. Every previous budget
counter and ceiling matches; only informational elapsed time and heap samples
are excluded from the comparison. The gate's documentation build takes 2.611s.

The six-file native runner exits zero: **2278/2278**, with no failures,
cancellations or skips. It executes write/registry/bulk failures, file cleanup,
real Socket.IO authorization and real concurrent transaction suites.

| Database | Ordinary invocation | Canonical invocation | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 379/379 | 379/379 | 11.398s / 38.154s |
| PostgreSQL 16.15 | 380/380 | 380/380 | 57.399s / 63.627s |
| MySQL 8.0.46 | 380/380 | 380/380 | 69.958s / 71.167s |

The concurrent-transaction suite adds one non-SQLite case. Registry fixtures
remain explicitly canonical; their appearance in the ordinary invocation is
not ordinary registry support. Real Redis verification also exits zero:
**92/92**, 46 per storage mode (24.278s / 23.761s), no skips/failures/cancellations.
The Redis application database is SQLite; separate SQL and Redis jobs do not
establish a combined deployment matrix. Overlapping durations are execution
records rather than performance claims.

The outcome definition selects `none`, `pending`, `committed`, `rolledBack` and
`unknown`. It defines ownership, snapshots, per-entry non-atomic outcomes,
savepoints and why none of these states authorizes automatic replay. A completed
driver object is insufficient outcome evidence. Backend completion responses,
including PostgreSQL reporting rollback for COMMIT, and outer managed ownership
still require implementation and testing under B1/B2. These definitions complete
the vocabulary item only; the current correction does not expose outcome fields.

Review rechecks every explicit owned commit site, the shared rollback guard,
post-commit errors, registry invalidation and the frozen-source before/after
comparison. All **272 final source hashes match**. Seven sources differ from
the previous manifest, including the new shared test helper. Package/lockfile,
dependency graph and parked migration patch are unchanged. Disposable SQL and
Redis directories are removed. Guides and capability evidence are updated,
then rebuilt and checked after this entry. This does not replace the final
Part C review or resume consumer verification.

Evidence files:

- `/tmp/library-completion-start-path`, identifying the saved source snapshot.
- `/tmp/library-completion-final-before-{knex,anyapi}.log`,
  `/tmp/library-completion-focused-{knex,anyapi}.log`.
- `/tmp/library-completion-final-{gate,native,redis}.log`,
  `/tmp/library-completion-final-source.json`.
- `/tmp/library-completion-final-audit.json`,
  `/tmp/library-completion-final-docs.log`.

## 2026-09-10: Non-atomic bulk cleanup and delivery

**85/214 complete (39.7%); 129 open.** Internal work is 73/138, API work
10/48, migration 2/14 and final review/report 0/14. **A7-08 is complete.**
A7-F02/F03/F04 are corrected. Managed outer completion, machine-readable
outcomes, previous-file replacement/deletion and remaining extension boundaries
keep A7-05/A7-09 and B1/B2 open. Consumer, seed and positioning work stays paused.

The bulk plugin discarded child cleanup diagnostics and remaining upload
tracking. Its three methods now isolate those fields for each child and collect
remaining entries in `finally`, adding the zero-based `bulkIndex` to shallow
copies. Original errors, storage objects and transaction objects retain their
identities; the child entries are not annotated. Successful warnings, rejected
non-atomic entries and atomic rethrows retain their evidence. Reusing the batch
context clears old diagnostics while retaining unresolved upload tracking
without importing it into new children.

Nine new core cases cover POST/PATCH/DELETE, multiple failed indexes, successful
later writes, real rollback followed by rejection, after-rollback failure and
post-commit failure. Sixteen bulk-file cases cover POST/PATCH in both formats,
actual stored/temporary files, cleanup warnings, rollback, failed deletion and
logging, post-commit failure before tracking release, database rows and context
reuse. All **25 fail on the saved prior source in each storage mode** (5.788s /
6.443s), with no skips or cancellations. The five-file focused selection then
passes **221/221 in each mode** (15.867s / 17.182s). An initial targeted lint run
found three property-layout errors in a new test; those were corrected, and the
final targeted and full lint runs pass.

The first full gate passes 4443/4444 ordinary, 4492/4492 canonical and 367/367
ordinary and 369/369 canonical Express 4 cases. However, the first native selection passes both
275-case SQLite jobs, then **259/275 ordinary PostgreSQL**, with sixteen failed
file URL assertions. The runner exits one and removes its disposable directory;
remaining native combinations are not counted as executed by that failed run.
Ordinary file columns use binary storage, and PostgreSQL returned their UTF-8
URLs as Buffers. The tests correctly require public string handles.

The existing attribute normalizer now decodes byte-backed `file` values with
strict UTF-8, preserving byte-order marks and rejecting invalid encoding through
the existing cause/context wrapper. It preserves custom getters' raw database
input and leaves blob fields alone. Five further tests cover both formats
through POST/PATCH/PUT/GET/query, Unicode, sliced views, null/missing fields,
immutability, invalid bytes and getter ownership. Before this correction the
new group passes **2/5**, with three failures (0.701s). The final file suite
passes **61/61 per mode** (2.056s / 1.697s). No column rewrite or stored-data
migration is needed. The complete patch adds **22 net runtime lines** across
two existing modules; it introduces no API translator or runtime module.

Real Socket.IO coverage adds twelve cases per storage mode: all three bulk
methods, both transports, and successful/rejecting rollback cleanup hooks.
Visible committed entries notify; pre-commit failures and hidden entries do not.
Real Redis adds twelve cases per mode, using two actual servers in both
writer directions and transports, with a rejected middle entry and secondary
cleanup failure. Client/inter-server acknowledgement barriers verify no extra
events; stored rows and indexed diagnostics are checked independently.

Final **Node 24.6.0** `npm run verify` exits zero:

| Job | Passed | Duration |
| --- | ---: | ---: |
| Full ordinary SQLite | 4448/4449; one existing skip, no failures | 120.708s |
| Full canonical SQLite | 4497/4497; no skips/failures | 149.130s |
| Express 4 ordinary | 367/367 | 13.406s |
| Express 4 canonical | 369/369 | 14.075s |

Types, lint, docs and both 44-workload budgets pass. Every counter and ceiling
matches the previous bulk-ownership gate; only informational elapsed time and
heap observations are excluded from the comparison. The gate's docs build takes
3.934s. This is verification of the current patch, not Part C's
final review.

The six-file native selection exits zero, **1680/1680**, with no failures,
cancellations or skips. It includes bulk failures/configuration/authorization,
file failures, Socket.IO authorization and transaction-context reuse.

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 280/280 | 280/280 | 18.121s / 39.881s |
| PostgreSQL 16.15 | 280/280 | 280/280 | 66.607s / 87.122s |
| MySQL 8.0.46 | 280/280 | 280/280 | 93.836s / 65.619s |

The final real Redis command also exits zero: **92/92**, 46 cases per storage
mode, with no skips/failures/cancellations (22.855s / 28.620s). This comprises
76 notification/reconnection/bulk cases and sixteen lifecycle cases. Redis uses
SQLite application storage; separate SQL checks do not establish a combined
SQL/Redis deployment matrix. Cluster/Sentinel and durable delivery remain
unverified. Overlapping job durations are execution records, not benchmarks.

The review rechecks all three child-context boundaries, error identity, retained
tracking across reuse, existing ownership/rollback guards and the shared file
normalizer's database/response stages. A post-commit hook can reject after its
write is stored: `meta.failed` counts rejected calls, not rolled-back writes.
Retained uploads can belong to committed data or pending outer work; their
presence is not permission to delete or retry. Managed completion and the
installed hook dispatcher's non-Error failure remain separate open work.

Bulk, migration, file, lifecycle, conformance and Redis guides describe these
contracts and limits. All **271 final source hashes match**; seven source files
differ from the preceding ownership manifest. Package/lockfile/dependency graph
and the parked jskit-ai migration patch retain their hashes. Both failed and
successful disposable native directories and the final Redis directory are
removed. No consumer or seed repository is changed. Documentation is rebuilt
and its rendered contracts, evidence anchors and checklist counts checked after
this entry.

Evidence files:

- `/tmp/library-bulk-context-final-before-{knex,anyapi}.log`,
  `/tmp/library-bulk-context-final-focused-{knex,anyapi}.log`.
- `/tmp/library-bulk-context-final-{gate,native}.log` preserve the first gate and
  the PostgreSQL failure; `/tmp/library-bulk-context-final-source.json` identifies
  that source.
- `/tmp/library-bulk-file-decoding-before.log`,
  `/tmp/library-bulk-file-decoding-focused-{knex,anyapi}.log`.
- `/tmp/library-bulk-file-final-{gate,native,redis}.log`,
  `/tmp/library-bulk-file-final-source.json`.
- `/tmp/library-bulk-file-budget-comparison.json`,
  `/tmp/library-bulk-file-final-audit.json`, `/tmp/library-bulk-file-final-docs.log`.

## 2026-09-10: Borrowed bulk transactions

**84/214 complete (39.3%); 130 open.** Internal work remains 72/138, API work
10/48, migration 2/14 and final review/report 0/14. **A7-F01 is corrected and
verified.** A7-07 stays open for the managed ownership/event contract and consumer
migration. Consumer, seed and positioning work stays paused.

Bulk POST/PATCH/DELETE ignored `params.transaction`: atomic calls opened and
committed a different transaction, while non-atomic children completed their
own writes. The corrected methods start with the supplied transaction, pass it
to every child and complete only a transaction they own. A small private
validation function rejects a supplied transaction with non-atomic mode before
any child or SQL. Ownership stays local and rollback uses the existing shared
helper. The change adds twelve net runtime lines in the existing bulk plugin;
it adds no runtime module, transaction manager, alias or compatibility path.

The new 24-case group in `conformance-bulk-failures.test.js` passes **0/24, with
24 failures in each storage mode**, against the old source (1.416s / 1.683s).
It covers all three bulk methods, both formats, caller commit and rollback,
pending records and inverse
membership, a following resource write in the same unit, failures after one or
two child writes, completed transactions and zero-SQL invalid-mode rejection.
Traces check transaction/auth identity, data/finish order and no child completion
hooks before the owner completes the transaction. State is inspected inside the
transaction and from a separate connection. The owner rolls back partial work
after a failure; a borrowed batch creates no savepoint.

The first patched focused runs pass **156/156 ordinary and 156/156 canonical**,
no failures/cancellations/skips (7.994s / 8.360s). They include the new cases,
existing atomic rollback diagnostics, bulk configuration/authorization,
non-atomic behavior and reused transaction contexts. Targeted lint passes.

Final **Node 24.6.0** `npm run verify` exits zero:

| Job | Passed | Duration |
| --- | ---: | ---: |
| Full ordinary SQLite | 4406/4407; one existing skip, no failures | 115.308s |
| Full canonical SQLite | 4455/4455; no skips/failures | 138.110s |
| Express 4 ordinary | 355/355 | 11.354s |
| Express 4 canonical | 357/357 | 12.597s |

Types, both 44-workload query budgets, lint and docs pass. Every prior budget
counter and ceiling is unchanged; only informational timing/heap observations
are excluded from that comparison. The full gate's documentation build takes
2.523s. This is the patch's gate, not the final Part C review.

The native runner also exits zero: **1,024/1,024**, no failures/cancellations/skips.
Its five selected suites cover bulk failure/ownership, configuration,
authorization, reused contexts and actual concurrent transactions.

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 170/170 | 170/170 | 7.628s / 10.959s |
| PostgreSQL 16.15 | 171/171 | 171/171 | 38.334s / 53.315s |
| MySQL 8.0.46 | 171/171 | 171/171 | 42.217s / 89.223s |

The native concurrency suite supplies the additional non-SQLite case. Independent
jobs overlap, so durations are execution records rather than performance claims.
The disposable native directory `/tmp/jra-db-Es02vc` is removed after completion.

Review rechecks all three bulk creation/commit/rollback branches, their unchanged
owned/non-atomic behavior, the shared resource completion helper and the two
registry commit sites. Resource/relationship and registry paths already guard
borrowed ownership; their managed outcomes and extension lifecycle still have
separate open requirements. This patch does not flush outer transaction events,
clean up borrowed uploads or introduce machine-readable outcomes. In-memory
notification queues and file tracking still need the selected B2 completion
mechanism. The installed hook dispatcher's non-Error failure remains separate.

The bulk guide and migration guide state the explicit transaction argument,
atomic-mode requirement, pending failure prefixes, caller rollback and current
side-effect limits. The lifecycle inventory and capability map include the new
coverage. This uses the existing API convention; no stored-data migration is
required. Captured consumer inventory found no bulk callers; current consumer
verification remains paused and no consumer source is changed.

All 271 final source hashes match. Only the bulk plugin and the existing bulk
failure suite differ from the preceding source manifest. Package, lockfile,
installed dependencies and the parked migration patch remain unchanged.
Documentation is rebuilt after this final entry and its rendered contract,
evidence anchors and checklist counts checked before reporting completion.

Evidence files:

- `/tmp/library-bulk-ownership-before-{knex,anyapi}.log`,
  `/tmp/library-bulk-ownership-focused-{knex,anyapi}.log`.
- `/tmp/library-bulk-ownership-final-gate.log`,
  `/tmp/library-bulk-ownership-final-native.log`.
- `/tmp/library-bulk-ownership-final-source.json`,
  `/tmp/library-bulk-ownership-start-path`.
- `/tmp/library-bulk-ownership-final-docs.log`.

## 2026-09-10: Capability evidence reconciliation

**84/214 complete (39.3%); 130 open.** Internal work is 72/138, API work 10/48,
migration 2/14 and final review/report 0/14. **A2-16 is complete.** Consumer, seed
and positioning work stays paused.

The [capability map](conformance.md#capability-map) now accounts for all 24 actual
root exports: fourteen plugins/file-storage classes, six error classes, three
error-code constants and getUrlPrefix. It includes installed resource/API
methods, storage/schema helpers, plugin config inspection, and the documented
bulk/positioning deep imports. The expanded shared-file table accounts for all
65 current conformance files exactly once. Existing tests are named with their
actual assertion/fixture scope, including indirect helper calls and successful
release teardown; those do not imply release-failure coverage.

The audit distinguishes passing execution, known failures, unimplemented
operations and unverified combinations. Native positioning still has five
concurrent failures per ordinary PostgreSQL/MySQL run; its canonical native run
is not executed because work is paused. Real S3 remains unimplemented. SQLite
writer conflicts, lexical canonical IDs, ordinary versus canonical schema
methods, explicit native collations and unsupported query/serializer operations
remain visible. No shared assertion is relaxed and no limitation is relabelled
unsupported merely to close the map. Lifecycle, configuration, storage-interface,
transaction/API work, package checks, consumer migration and final reviews retain
their own open acceptance conditions.

Documentation now names the actual mysql2 configuration and tested database
versions, removes examples relying on nonexistent context.db capability flags,
accounts for all seven native runner support files, and records the dedicated
canonical MySQL ID-collation cases separately from default binary comparison.
The Redis guide now reflects the Node 24-only CI policy. Older milestone counts
remain historical evidence, with current status stated at the top.

A focused refresh runs the existing labels and SQL-backed Socket.IO authorization
suites against the unchanged current source on **Node 24.6.0**. The runner exits
zero: **684/684 pass**, no failures, cancellations or skips.

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 114/114 | 114/114 | 7.866s / 10.195s |
| PostgreSQL 16.15 | 114/114 | 114/114 | 40.410s / 44.785s |
| MySQL 8.0.46 | 114/114 | 114/114 | 43.856s / 52.453s |

The separate actual Redis 7.0.15 lifecycle/notification command also exits zero:
**34/34 ordinary and 34/34 canonical**, no failures/cancellations/skips
(6.450s / 8.849s). This is **68/68** with SQLite application storage. Running
SQL and Redis suites separately does not verify every combined deployment.
Both disposable directories, `/tmp/jra-db-aZuVMW` and `/tmp/jra-db-vErI08`, are
removed after completion.

No runtime, test, script, workflow, package or installed dependency changes in
this batch. All 271 files in the preceding final source manifest still match;
the parked migration patch is unchanged. The preceding full Node 24 gate remains
applicable: 4382/4383 ordinary (one existing skip), 4431/4431 canonical,
355/355 and 357/357 Express 4, types, both 44-workload budgets and lint pass.
That full gate is not rerun for this documentation-only change. The selected
refresh is not a run of the entire current native matrix or Part C review.
Documentation is rebuilt and its rendered map, links, counts and evidence checked
before this item is reported complete.

Reproduce the refresh using Node 24 with the documented disposable binaries:
`node scripts/test-databases.js all tests/conformance-labels.test.js tests/conformance-socketio-authorization.test.js`
and `npm run test:redis`. No consumer verification, publication or remote CI
run is claimed.

Evidence files:

- `/tmp/library-capability-reconciliation-native.log`,
  `/tmp/library-capability-reconciliation-redis.log`.
- `/tmp/library-capability-reconciliation-audit.json`,
  `/tmp/library-link-attachment-final-source.json`.
- `/tmp/library-capability-reconciliation-docs.log`.

## 2026-09-10: Canonical attachment allocation

**83/214 complete (38.8%); 131 open.** Internal work is 71/138, API work 10/48,
migration 2/14 and final review/report 0/14. **A8-F24 is corrected and A8-07 is
complete.** Consumer, seed and positioning work stays paused.

The existing canonical attachment loop now reads at most 101 physical rows per
page for each 100-target batch. It keeps only the first exact match for requested
IDs, bounding its lookup to 100 entries even with duplicate edges or alternate
stored spellings. The existing single-row lookup resolves other spellings under
database equality. Paging uses the existing native physical ID order and locks
every matching edge, including the final page. First-match inverse repairs,
payloads, target locks and transaction ownership are preserved. The change stays
in one existing runtime module and follows the ordinary pivot writer's paging
pattern; it adds no runtime module, API option or compatibility mechanism.

The corrected new 17-case SQLite suite fails 17/17 against the saved old source
(3.364s). It covers three relationship directions, 501 duplicate stored links,
33,000 repeated inputs, several target batches, a retained target after duplicate
pages, payload/inverse repair, and owned/borrowed failure after 100 inserts.
Native cases hold a lock on the final duplicate edge; MySQL adds three explicit
case-insensitive ID cases. The initial patched focused run passes 88/94 ordinary
and 93/99 canonical, with six failure-injection misses each: the mock intercepted
the root Knex client, while the write uses a transaction client. Moving the mock
to the observed transaction corrects that test setup without changing runtime
code. Final focused results are **94/94 ordinary / 99/99 canonical**
(22.446s / 22.416s), no skips/failures.

Final Node 24.6.0 `npm run verify` exits zero:

| Job | Passed | Duration |
| --- | ---: | ---: |
| Full ordinary SQLite | 4382/4383; one existing skip, no failures | 127.546s |
| Full canonical SQLite | 4431/4431; no skips/failures | 143.252s |
| Express 4 ordinary | 355/355 | 20.026s |
| Express 4 canonical | 357/357 | 19.619s |

Type checking, both 44-workload budgets, lint and docs pass. Final selected
native jobs total **787/787**, no failures/skips:

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 129/129 | 130/130 | 29.230s / 56.273s |
| PostgreSQL 16.15 | 130/130 | 131/131 | 87.026s / 98.843s |
| MySQL 8.0.46 | 133/133 | 134/134 | 47.312s / 49.191s |

These combine the first native run's four passing SQLite/PostgreSQL jobs with
the final MySQL-only run. The first run stopped at MySQL ordinary: 130/133 passed,
and the three new spelling tests failed because the standard native fixture
explicitly uses binary ID comparison. Those MySQL-only tests now configure
matching case-insensitive logical/link ID columns and assert that setup before
the public write. No production correction was required. Full-run and final
271-file manifests differ only in that conditional test block; all runtime and
SQLite/PostgreSQL test behavior remain unchanged. MySQL alone is rerun after
the fixture correction, and both jobs pass.

The native selection covers the new attachments, existing target/edge batching,
canonical deletion/replacement, concurrent transactions, bigint IDs and budgets.
Explicit canonical suites retain their fixture scope in either runner mode.
Native concurrency adds one case per job; the three configured-collation cases
account for MySQL's additional cases. These are this patch's checks, not Part C's
final whole-goal review or paused consumer verification.

The [before/after probe](query-measurements.md#canonical-attachment-duplicate-rows)
preserves all 705 stored rows and payloads in three directions. Its one-ID add
changes a single **501-row read to `[101, 101, 101, 101, 97]`**. Total rows read
remain 501; operation statements increase **7→11** to preserve locked coverage
with bounded application allocation. No peak-heap or latency reduction is claimed.
All eight relevant 44-workload reports match the preceding counters and ceilings;
normal workloads require no budget adjustment.

A8-07 now has evidence for bounded target/physical-row batches, large complete
predicates, repeated identifiers, visibility before allocation, limited parent
maps and request-local graph lookups. The [allocation reconciliation](query-measurements.md#allocation-reconciliation)
classifies required whole-input and output copies, including tested isolation
of 100/1,000/5,000-child write responses. Review rechecked the canonical and
ordinary attachment loops, target/validation uniqueness, reverse membership,
include/visibility intermediates, map bounds, paging/first-match ordering, locks
and failure ownership. Per-child lifecycle optimization, consumer verification
and final whole-codebase reviews remain separate open items.

All 271 final source hashes match. Package/lock, dependency and parked-consumer
patch hashes remain unchanged. Disposable directories `/tmp/jra-db-baBlZX` and
`/tmp/jra-db-TBSfRq` are removed. Evidence and migration documentation are rebuilt
after this entry and rendered content/anchors checked. No consumer source or
installed dependency is changed.

Evidence files:

- `/tmp/library-link-attachment-before.log`,
  `/tmp/library-link-attachment-corrected-before.log`,
  `/tmp/library-link-attachment-focused-{knex,anyapi}.log`,
  `/tmp/library-link-attachment-final-focused-{knex,anyapi}.log`.
- `/tmp/library-link-attachment-final-gate.log`,
  `/tmp/library-link-attachment-first-native.log`,
  `/tmp/library-link-attachment-final-mysql.log`.
- `/tmp/library-link-attachment-{full,final}-source.json`,
  `/tmp/library-link-attachment-probe.mjs`,
  `/tmp/library-link-attachment-probe-{before,after}.log`.

## 2026-09-10: Canonical linkage visibility

**82/214 complete (38.3%); 132 open.** Internal work remains 70/138, API work
10/48, migration 2/14 and final review/report 0/14. **A8-F23 is corrected and
verified.** A8-07 stays open for the separate confirmed duplicate-edge attachment
finding, A8-F24. Consumer, seed and positioning work stays paused.

Canonical default many-to-many linkage now applies target permissions and row
filters in SQL before allocating link rows. The existing scoped include-filter
helper builds a target-ID subquery limited to the requested parents' relationship;
the existing forward/inverse link predicates use it before physical paging.
This removes the full hidden-edge identifier list, visibility map/set and
filtered-row copy. It changes two existing runtime modules, reuses an existing
internal helper and adds one private query builder. No new module, dependency,
public response option or compatibility path is introduced.

The raw link-row helper preserves complete physical-edge results. Default
linkage preserves physical duplicate edges; `listMany` preserves its SQL UNION
deduplication. Physical GET queries still take 100 requested parents and return
at most 101 link rows. The target filter is built once per relationship read,
with caller auth/transaction, target metadata and no parent filters. The migration
guide explains the changed hook timing, including empty relationships and a
parent GET's other independently filtered relationships.

The initial pre-fix 51-case suite passes 39 and fails 12. The first focused
selection after implementation passes 180/181; one assertion counted the forward
parent's three other reverse-relationship filters. The corrected observer
identifies the requested link query. Direct `listMany`, duplicate/missing edges
and bigint/permission coverage then pass 254/254 (19.338s). The final link suite
adds 205 parents crossing three batches and passes 57/57 (1.851s), retaining its
33,000 repeated-parent and later-page/owned/borrowed failure cases. The existing
fixture accepts a configured query maximum solely to exercise multiple parent
batches. Formatting fixes precede the frozen verification source.

Final Node 24.6.0 `npm run verify` exits zero:

| Job | Passed | Duration |
| --- | ---: | ---: |
| Full ordinary SQLite | 4365/4366; one existing skip, no failures | 116.522s |
| Full canonical SQLite | 4414/4414; no skips/failures | 146.709s |
| Express 4 ordinary | 355/355 | 15.873s |
| Express 4 canonical | 357/357 | 17.748s |

Type checking, both 44-workload budgets, lint and docs also pass. The selected
native matrix exits zero with **1,554/1,554**, no failures/skips:

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 260/260 | 258/258 | 12.050s / 38.719s |
| PostgreSQL 16.15 | 260/260 | 258/258 | 75.165s / 102.934s |
| MySQL 8.0.46 | 260/260 | 258/258 | 93.022s / 54.209s |

The selection covers link prefetch, include permissions, visibility batches,
relationship metadata, canonical link deletion, bigint IDs and query budgets.
The link suites explicitly select canonical storage in either outer runner;
other suites retain their declared fixture scopes. Permission/metadata suites
also exercise real Express/Fastify requests on those databases. These results
verify this patch, not the final whole-goal review or paused consumer workflows.

The [before/after probe](query-measurements.md#canonical-linkage-visibility-allocation)
passes 18 observations per source across unpaired/forward/inverse relationships.
With all 205 targets hidden, link rows fetched drop **205→0** and sparse GET SQL
statements **8→3**, preserving exact results. With two hidden targets, fetched
rows drop **205→203** and statements **8→5**. `listMany` drops **4→1** statements;
forward relationship endpoints retain three other reverse-relationship reads.
These are fetched-row/statement measurements, not peak heap or query-plan timing.
Seven canonical workload counters decrease by one. Their ceilings and the
size-1/10 policy ceilings are tightened to actual counts. All eight full/native
reports match all 44 counters and ceilings, ignoring only elapsed/heap samples.

The [allocation reconciliation](query-measurements.md#allocation-reconciliation)
traces required whole-input and result copies through validation, locking,
loaders, include/normalization maps, plain expansion, write response ownership
and sequential bulk operations. A final read-through found one separate
avoidable intermediate: canonical attachment reads every physical duplicate
for each requested target. A public canonical SQLite probe confirms an
idempotent one-ID add reads **501 rows in one query**, for all three directions,
and preserves all 705 stored edges. This is **A8-F24, open**; no production fix
for it is included in this source. A8-07 therefore remains unchecked.

All 270 frozen source hashes match throughout the full/native gates. Package,
lock/dependency and parked-consumer-patch hashes are unchanged. The disposable
database directory `/tmp/jra-db-5f4n15` is removed. The final evidence and migration
prose are rebuilt and their rendered anchors/content checked separately. No
consumer checkout is changed or verified.

Evidence files:

- `/tmp/library-link-visibility-before.log`,
  `/tmp/library-link-visibility-focused.log`,
  `/tmp/library-link-visibility-final-focused.log`,
  `/tmp/library-link-visibility-parent-batches.log`.
- `/tmp/library-link-visibility-budgets.log`,
  `/tmp/library-link-visibility-final-gate.log`,
  `/tmp/library-link-visibility-final-native.log`.
- `/tmp/library-link-visibility-final-source.json`,
  `/tmp/library-link-visibility-probe.mjs`,
  `/tmp/library-link-visibility-probe-{before,after}.log`.
- `/tmp/library-duplicate-link-write-probe.mjs` and
  `/tmp/library-duplicate-link-write-probe.log`.

## 2026-09-10: Reverse membership allocation

**82/214 complete (38.3%); 132 open.** Internal work remains 70/138, API work
10/48, migration 2/14 and final review/report 0/14. This corrects **A8-F22** within
the open A8-07 allocation review. Consumer, seed and positioning work stays paused.

The existing reverse relationship writer no longer loads every child to add or
remove a requested member. It reads at most 100 requested IDs per batch, reuses
the existing target-lock helper for additions/replacements, and resolves ID
equality through the database. A replacement excludes the complete keep-list,
then unlinks removed children in native ID order, with at most 101 identities
per page. It retains no complete old-membership set or removed-ID array. Each
changed child still runs PATCH with its permissions, caller context and enclosing
transaction. All removals finish before any hasOne replacement is assigned.
This changes one existing runtime module; no new helper module, dependency,
response option or compatibility path is added.

The corrected pre-fix suite passes **4/22 and fails 18/22 per mode** (2.001s
ordinary / 2.189s canonical). It reproduces excessive membership reads and
redundant or missing writes for database-equivalent ID spellings. The first draft's
ordinary PUT case used a read fixture with two reverse aliases of the same
foreign key; it was removed before that baseline because PUT clears omitted
relationships. Existing dedicated PUT fixtures and the new polymorphic PUT case
retain coverage of the selected replacement contract.

The final new suite has **30 cases**: ordinary and reverse-polymorphic membership,
33,000 repeated additions/removals, multiple input batches/read pages, mapped
IDs, resource PATCH/polymorphic PUT, child hook counts/order, borrowed completion,
and read/child failures after a successful page. Three case-insensitive ID cases
explicitly select ordinary storage, including in the canonical invocation.
The first focused selection passes **98/98 ordinary / 94/94 canonical**
(2.686s / 2.906s), before the final eight tests. The expanded selection also adds
existing concurrent-transaction tests and passes **138/138 / 134/134**
(4.233s / 4.356s), without skips.

The new failure mock initially assumed every Knex statement was an object; it
intercepted a string rollback command and left that test's transaction open.
Only the two affected test-file processes were stopped. The mock now passes
string commands through, and cleanup restores the mock and rolls back an
unfinished observed transaction even if an assertion fails. Production cleanup
code was unchanged.

Final Node 24.6.0 `npm run verify` exits zero:

| Job | Passed | Duration |
| --- | ---: | ---: |
| Full ordinary SQLite | 4347/4348; one existing skip, no failures | 132.513s |
| Full canonical SQLite | 4396/4396; no skips/failures | 136.676s |
| Express 4 ordinary | 355/355 | 14.295s |
| Express 4 canonical | 357/357 | 17.536s |

Type checking, both 44-workload budgets, lint and documentation build pass.
The native selection covers reverse membership, existing relationship writes,
bigint IDs, concurrent transactions, target locking/link batches and budgets.
Its final passing jobs total **871/871**, no failures/skips:

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 144/144 | 145/145 | 32.117s / 32.397s |
| PostgreSQL 16.15 | 145/145 | 146/146 | 41.106s / 39.682s |
| MySQL 8.0.46 | 145/145 | 146/146 | 26.461s / 38.220s |

These results combine the first four jobs of the second native run with the
final MySQL-only run. The first native run stopped at PostgreSQL ordinary:
126/145 passed and 19 row-observation assertions failed because query-response
events contain `$1` placeholders. The observer now recognizes those placeholders.
The second run passed both SQLite and PostgreSQL modes, then MySQL ordinary
passed 138/145 with seven incorrect binding-limit assertions. MySQL uses the
existing text-protocol complete keep-list; its replacement predicate is now
checked against that input bound, while other batches retain the 100-ID bound
and every membership read retains the 101-row ceiling. MySQL alone was rerun
after this database-specific test correction; production source never changed
after the initial focused pass. Existing suites retain their explicit fixture
scopes, and real-driver concurrency explains the one-test SQLite/native offset.

The [before/after probe](query-measurements.md#reverse-membership-changes) uses
both reverse directions and storage modes. One-child add/remove membership
reads fall from **1,001 rows to 1**, preserving all final identities and child
write counts. Replacement and clearing retain bounded read pages, at the cost
of more statements; the table reports that tradeoff explicitly. The complete
input/keep-list still scales with the request. Per-child lifecycle cost remains
under A8-04; remaining linkage/visibility intermediates and necessary input/result
copies still require the final A8-07 reconciliation.

All eight relevant budget reports match all 44 preceding counters, ignoring
only elapsed time and heap deltas; no workload ceiling changes. All 270 final
source hashes match. Full-run, PostgreSQL-run and final manifests differ only
in the new test's SQL observer and MySQL-specific binding assertion; all runtime
and other selected test hashes are identical. Package/lock, dependency and
parked-consumer-patch hashes remain unchanged. Disposable database directories
`/tmp/jra-db-ywIzvA`, `/tmp/jra-db-mQOVqh` and `/tmp/jra-db-oyYWor` are removed.

Review covered native-key paging while child rows change, complete keep-list
semantics, database identity equality, target/parent locks, hasOne ordering,
failure propagation and borrowed ownership, followed by the full/native tests
and before/after probe. This verifies this patch, not Part C's final three
whole-goal reviews. The migration guide explains child-hook ordering and ID
equality without changing method arguments. Documentation is rebuilt after this
entry and rendered evidence/migration content is checked. Consumer checkouts
are neither changed nor verified.

Evidence files:

- `/tmp/library-reverse-membership-corrected-before-{knex,anyapi}.log`;
  `/tmp/library-reverse-membership-focused-{knex,anyapi}.log`.
- `/tmp/library-reverse-membership-expanded-{knex,anyapi}.log` (stopped test mock),
  `/tmp/library-reverse-membership-corrected-expanded-{knex,anyapi}.log`.
- `/tmp/library-reverse-membership-final-gate.log`,
  `/tmp/library-reverse-membership-first-native.log`,
  `/tmp/library-reverse-membership-second-native.log`,
  `/tmp/library-reverse-membership-final-mysql.log`.
- `/tmp/library-reverse-membership-{full,postgres,final}-source.json`.
- `/tmp/library-reverse-membership-probe.mjs` and
  `/tmp/library-reverse-membership-probe-{before,after}-{knex,anyapi}.log`.


## 2026-09-10: Empty include documents

**82/214 complete (38.3%); 132 open.** Internal work remains 70/138, API work
10/48, migration 2/14 and final review/report 0/14. This corrects **A8-F21**;
A2-16's complete capability map and A8-07's input/result allocation review remain
open. Consumer, seed and positioning work remains paused.

Both storage response builders now preserve `included: []` when an explicit
include returns no resources. The related-response boundary also handles null
to-one data and empty collections. Request setup and HTTP parsing preserve the
difference between an omitted include and an explicit empty array. HTTP
`?include=` survives serialization. The existing pagination link builder moves
to the existing URL helper module and is reused for single-resource and related
top-level self links, preserving includes and fieldsets on refresh. Resource
identity URLs and programmatic plain/minimal/none return contracts remain intact.
These changes use nine existing runtime modules, with no presence flag, new
option, helper module, dependency or compatibility path.

The 53-case shared public suite covers seven relationship directions, reads,
null/empty data, reused query objects and contexts, explicit empty includes,
pagination/self-link round trips, formats, full owned/borrowed POST/PATCH/PUT,
real Express/Fastify requests and errors. Two parser regressions cover omission,
repeated keys and empty serialization. With all ten parser cases, the pre-fix
baseline passes **11/63 and fails 52/63 in each mode** (2.912s ordinary / 3.068s
canonical). The initial runtime candidate retained an own undefined include
property, which the schema validator rejected during fixture seeding. Setup now
omits the property; array validation is unchanged.

The corrected include/parser/format/cyclic selection passes **181/181 per mode**
(4.404s / 4.578s). The new real Express HTTP selection also passes on Express 4:
**10/10 per mode**, no skips (0.822s / 0.841s). The first full ordinary run found
one older depth test expecting an explicit empty include to omit `included`:
4316/4318 passed, one failure and one existing skip. Its response expectation
now asserts the empty array, retaining the depth/path checks. That nine-test file
passes (0.446s); no runtime change was needed for this failure.

Final Node 24.6.0 `npm run verify` exits zero:

| Job | Passed | Duration |
| --- | ---: | ---: |
| Full ordinary SQLite | 4317/4318; one existing skip, no failures | 110.005s |
| Full canonical SQLite | 4366/4366; no skips/failures | 120.818s |
| Express 4 ordinary | 355/355 | 12.643s |
| Express 4 canonical | 357/357 | 16.048s |

Type checking, both 44-workload budgets, lint and documentation build pass.
The native selection covers empty includes, parsing, formats, related reads,
pagination, cyclic includes and query budgets. It exits zero with **1332/1332**,
no skips/failures:

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 222/222 | 222/222 | 7.762s / 16.153s |
| PostgreSQL 16.15 | 222/222 | 222/222 | 54.364s / 72.186s |
| MySQL 8.0.46 | 222/222 | 222/222 | 21.488s / 29.389s |

The new public suite follows the actual selected storage mode; parser cases
repeat in each job. Existing suites retain their explicit fixture scopes. The
standard Express 4 command has an explicit file list; the additional 10-case
selection above supplies Express 4 coverage for this new file.

All eight final budget reports match all 44 preceding workload counters,
ignoring only elapsed time and heap deltas; no ceiling changes. All 269 final
source hashes match. The native and final manifests differ only in the old
depth-test expectation, outside the native selection; all runtime and selected
test hashes are identical. Package/lock, dependency and parked-consumer-patch
hashes remain unchanged. Disposable directory `/tmp/jra-db-HerGjt` is removed.
The original four-case empty-included probe now passes in both modes.

Review checked request presence, response assembly, null/empty related branches,
query serialization, HTTP self-link round trips and write-return contracts, then
the final full/native gates and original reproducer. This verifies this patch,
not Part C's whole-goal final review. The migration guide explains empty include
documents, parser/hook expectations and refresh links. Documentation is rebuilt
after this entry and rendered evidence/migration content is checked. Consumer
checkouts are neither changed nor verified.

The next allocation review has begun with full PATCH responses containing
100/1,000/5,000 children in both formats and storage modes. All twelve observations
retain complete output isolated from after-commit observer mutations. These are
Node 24 SQLite retained-heap samples, not peak-memory bounds or a multi-driver
measurement. The initial probe incorrectly assumed numeric ID ordering in
canonical storage; its assertion now checks values by resource identity.
The [allocation measurements](query-measurements.md#full-write-response-allocation)
record the corrected results and limits. No response-copy removal is justified
by this probe alone, and A8-07 remains open.

Evidence files:

- `/tmp/library-empty-included-tests-before-{knex,anyapi}.log` (pre-fix baseline).
- `/tmp/library-empty-included-focused-{knex,anyapi}.log` (initial undefined
  include rejection), `/tmp/library-empty-included-expanded-{knex,anyapi}.log`
  (corrected focused selection), and
  `/tmp/library-empty-included-express4-{knex,anyapi}.log`.
- `/tmp/library-empty-included-first-gate.log`,
  `/tmp/library-empty-included-depth-expectation.log`, and
  `/tmp/library-empty-included-final-gate.log`.
- `/tmp/library-empty-included-final-native.log`,
  `/tmp/library-empty-included-native-source.json`, and
  `/tmp/library-empty-included-final-source.json`.
- `/tmp/library-empty-included-final-probe-{knex,anyapi}.log` (original reproducer).
- `/tmp/library-response-allocation-profile.mjs` and
  `/tmp/library-response-allocation-profile-{knex,anyapi}.log`; first-attempt
  logs are preserved as `/tmp/library-response-allocation-profile-initial-{knex,anyapi}.log`.


## 2026-09-10: Cyclic resource identity

**82/214 complete (38.3%); 132 open.** Internal work remains 70/138, API work
10/48, migration 2/14 and final review/report 0/14. This corrects **A8-F20**
under the capability/include audit. A2-16 and A8-07 remain open. Consumer,
seed and positioning work remains paused.

Both existing include maps now begin with primary resource identities. Ordinary
storage shares each primary record's relationship object with the map; canonical
storage shares the resource object. Nested traversal and target authorization
still execute, while relationships discovered through a cycle reach the primary
representation. Primary entries are omitted from the returned included array
before field enrichment. The existing plain converter indexes primary resources
as well as included resources, preserving peer expansion, separate branches and
identifier termination at actual cycles. This uses three existing runtime modules;
no new helper module, option, schema, dependency or compatibility path is added.

The first canonical implementation exposed a limit interaction: default linkage
on a later path could overwrite an earlier explicit collection limit. Default
reverse and many-to-many hydration now reads and assigns only missing
relationships. Explicit include loaders retain their limit behavior. Tests check
both path orders for reverse, many-to-many and reverse-polymorphic collections,
and separately check a target shared by sibling include paths.

The new 58-case public suite uses the existing shared ID fixture and runs through
both actual storage modes. It covers all six relationship directions, GET/query/
related operations, primary collections, computed callbacks, sparse fields,
visibility, nested linkage, plain peers/cycles, limits and borrowed full
POST/PATCH/PUT with rollback. Three existing plain-conversion cycle fixtures no
longer duplicate primaries; their full 13-case suite joins the baseline. The corrected pre-fix
baseline passes **12/71 and fails 59/71 per mode** (7.757s ordinary / 8.174s
canonical). Initial test drafts needed the policy's required `true` return and
a path within the fixture's existing depth-three limit; both were corrected
before that baseline comparison.

The shared response assertion now checks identity uniqueness across primary
and included data. Older bigint, sparse-hydration and nested-include assertions
that expected duplicate primaries are updated without removing linkage/fieldset
checks. Six additional real Express/Fastify HTTP cases exercise cyclic GET,
POST and PATCH. The enlarged Express 4 metadata HTTP selection passes **6/6
per mode** (0.737s / 0.787s), without skips.

Focused existing/new include, plain, bigint, sparse and metadata suites pass
**231/231 ordinary** (7.910s) and **227/227 canonical** (8.268s). These runs
precede the six additional HTTP cases; the full/native gates include them.
The initial full ordinary gate passes 4261/4263 with one existing skip and one
failure: the old nested-include test expected two primary authors again in
included. Its book-to-author linkage checks remain intact, and the corrected
six-test file passes (1.076s). No runtime correction was needed for that failure.

Final Node 24.6.0 `npm run verify` exits zero:

| Job | Passed | Duration |
| --- | ---: | ---: |
| Full ordinary SQLite | 4262/4263; one existing skip, no failures | 80.414s |
| Full canonical SQLite | 4311/4311; no skips/failures | 87.397s |
| Express 4 ordinary | 355/355 | 9.872s |
| Express 4 canonical | 357/357 | 13.434s |

Type checking, both 44-workload budgets, lint and documentation build pass.
The native selection covers cyclic includes, plain conversion, bigint IDs,
include limits/permissions, sparse hydration, response metadata and query
budgets. It exits zero with **2124/2124**, no skips/failures:

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 356/356 | 352/352 | 12.283s / 31.137s |
| PostgreSQL 16.15 | 356/356 | 352/352 | 74.690s / 28.898s |
| MySQL 8.0.46 | 356/356 | 352/352 | 23.234s / 42.458s |

The new public suites follow the actual selected storage mode. Pure conversion
cases repeat in each job; existing suites retain their explicit fixture scopes.
All eight budget reports match all 44 preceding workload counters, ignoring only
elapsed time and heap deltas. No ceiling is loosened. All 268 final source hashes
match. Native-run and final manifests differ only in the old nested-include test
expectation, which is outside the native selection; all runtime and selected
test hashes are identical. Package/lock, dependency and parked-consumer-patch
hashes remain unchanged. Disposable directory `/tmp/jra-db-aJcUfd` is removed.
The original GET/query cyclic probes now exit zero in both modes with identities
`items/1, groups/1` and one computation per resource.

Review checked assembly before enrichment, sparse/visibility/transaction and
limit interactions, then the full/native gates and original reproducer against
the final runtime. These are reviews of this patch, not completion of Part C's
whole-goal final review. The migration guide explains indexing both primary and
included resources, updated snapshots and callback expectations. Documentation
is rebuilt after this entry and rendered evidence/migration content is checked.
Consumer checkouts are neither changed nor verified.

**Next finding: A8-F21 is open.** Explicit includes with empty relationships or
empty primary data omit the included member in both modes. Four public GET/query/
related cases match the preceding snapshot and fail the expected-empty-array
assertion. JSON:API requires the included member for an explicit supported
include even when it is empty. [Inclusion requirements](https://jsonapi.org/format/#fetching-includes).
The next correction must distinguish omitted and explicitly empty includes
through HTTP parsing and cover empty/null results and full write responses.
Full input/result allocation remains the next A8-07 review boundary.

Evidence files:

- `/tmp/library-cyclic-resources-corrected-before-knex.log` and
  `/tmp/library-cyclic-resources-corrected-before-anyapi.log` (corrected baseline).
- `/tmp/library-cyclic-resources-final-focused-knex.log` and
  `/tmp/library-cyclic-resources-final-focused-anyapi.log` (focused selection).
- `/tmp/library-cyclic-resources-limits-anyapi.log` (six limit interaction failures
  in the initial candidate); `/tmp/library-cyclic-resources-express4-{knex,anyapi}.log`.
- `/tmp/library-cyclic-resources-first-gate.log` (old author duplication assertion),
  `/tmp/library-cyclic-resources-nested-expectation.log` and
  `/tmp/library-cyclic-resources-final-gate.log` (final complete gate).
- `/tmp/library-cyclic-resources-final-native.log`,
  `/tmp/library-cyclic-resources-native-source.json` and
  `/tmp/library-cyclic-resources-final-source.json` (native/final source scope).
- `/tmp/library-cyclic-resources-final-probe-{knex,anyapi}.log`
  (original reproducer passes).
- `/tmp/library-empty-included-probe.mjs` and
  `/tmp/library-empty-included-[before-]{knex,anyapi}.log`
  (four failing cases for the next finding in both snapshots/modes).


## 2026-09-10: Response dependency metadata

**82/214 complete (38.3%); 132 open.** Internal work remains 70/138, API work
10/48, migration 2/14 and final review/report 0/14. This corrects **A8-F19**
under the capability/include audit; A2-16 and A8-07 remain open. Consumer, seed
and positioning work remains paused.

The existing `normalizeRecordAttributes` response pass now removes
`COMPUTED_DEPENDENCIES_KEY` from primary and included resource objects. It runs
only for `source: 'response'`, after enrichment and finish hooks; database-stage
normalization still supplies the metadata to computations. The removal precedes
the attributes/schema early return, so minimal resources are cleaned too. It does
not walk into caller attributes, document/resource/relationship metadata or plain
attribute data. The runtime change is one import and two lines in the existing
normalizer; no new utility, dependency, option, query or compatibility path.

The 58-case suite uses the existing shared ID fixture. An initial PUT test
omitted persisted to-one fields and was corrected to supply its complete document
before the baseline comparison. The corrected suite reproduces **55 failures
and 3 passes per mode** (1.279s ordinary / 1.405s canonical). Coverage includes
normal/computed fields, all six relationship directions, standard/window loaders,
GET/query/related reads, full POST/PATCH/PUT, nested plain records, borrowed
minimal/full writes, finish-hook additions, real Express/Fastify responses and
normalization of empty/minimal documents. Caller metadata and dependency arrays
retain their values. Computed output and callback counts remain correct.

The fix passes the new suite and existing dependency/callback-failure coverage:
**342/342 ordinary** (8.764s) and **343/343 canonical** (9.254s). The new HTTP
checks also run through the existing Express 4 loader: **3/3 per mode**
(3.231s / 4.462s), without skips. Formatting and repository lint pass before the
final 267-source freeze.

Final Node 24.6.0 `npm run verify` exits zero:

| Job | Passed | Duration |
| --- | ---: | ---: |
| Full ordinary SQLite | 4198/4199; one existing skip, no failures | 105.904s |
| Full canonical SQLite | 4247/4247; no skips/failures | 105.803s |
| Express 4 ordinary | 355/355 | 13.111s |
| Express 4 canonical | 357/357 | 12.573s |

Type checking, both 44-workload budgets, lint and documentation build pass. The
final native selection covers response metadata, field dependencies, callback
failures and query budgets. It exits zero with **2061/2061**, no skips/failures:

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 343/343 | 344/344 | 4.683s / 16.372s |
| PostgreSQL 16.15 | 343/343 | 344/344 | 41.920s / 63.064s |
| MySQL 8.0.46 | 343/343 | 344/344 | 47.963s / 52.887s |

The new suite follows the actual storage mode; its four pure normalizer cases
also run in each job. Existing suites retain their explicit fixture scopes.
All eight budget reports match the preceding 44 workload counters, with no
loosened ceiling. All 267 frozen source hashes match; package/lock, dependency
and parked-consumer-patch hashes are unchanged. Disposable directory
`/tmp/jra-db-k2EHXg` is removed. Both original public metadata probes now exit
zero and show clean included resources.

**Next finding: A8-F20 is open.** A cyclic `groups.items` include returns the
primary item again in `included`, and computes its field twice, through both
GET and query in both modes. Probes against the preceding snapshot produce
identical observations. This conflicts with compound-document resource identity;
the follow-up must preserve linkage, sparse fields and plain traversal while
using one representation per resource. [JSON:API compound documents](https://jsonapi.org/format/#document-compound-documents).
The shared response-structure assertion currently does not detect such duplicates.
No runtime correction for this separate finding is included in the metadata fix.

Evidence files:

- `/tmp/library-response-metadata-before-knex.log` and
  `/tmp/library-response-metadata-before-anyapi.log` (corrected failing baseline).
- `/tmp/library-response-metadata-focused-knex.log` and
  `/tmp/library-response-metadata-focused-anyapi.log` (dependencies and failures).
- `/tmp/library-response-metadata-express4-knex.log` and
  `/tmp/library-response-metadata-express4-anyapi.log` (new Express 4 assertions).
- `/tmp/library-response-metadata-final-gate.log`,
  `/tmp/library-response-metadata-final-native.log`,
  `/tmp/library-response-metadata-final-source.json` (final verification).
- `/tmp/library-response-metadata-final-probe-knex.log` and
  `/tmp/library-response-metadata-final-probe-anyapi.log` (original probe now passes).
- `/tmp/library-cyclic-resource-probe.mjs` and
  `/tmp/library-cyclic-resource-before-probe.mjs`, with their ordinary/canonical
  logs (failing GET/query uniqueness assertions for the next finding).

Documentation is rebuilt after this entry and rendered verification/migration
content is checked. Consumer checkouts are neither changed nor verified.


## 2026-09-10: Lossless SQL bigint identifiers

**82/214 complete (38.3%); 132 open.** Internal work remains 70/138, API work
10/48, migration 2/14 and final review/report 0/14. This corrects **A8-F18**;
A8-07's wider allocation review remains open. Consumer, seed and positioning
work remains paused.

Ordinary SQL bigint primary/reference values previously rounded before response
normalization in SQLite/MySQL. Adjacent targets could collapse during validation
or disappear from includes. The correction reuses the database normalizer module
for a SQLite identity SELECT/RETURNING expression and enables MySQL's per-query
`supportBigNumbers` option. SQLite converts only INTEGER values outside the safe
Number range to text; safe numbers, REAL references, nulls and opaque text keep
their existing representation. PostgreSQL retains its bigint decoder. Native
columns still govern predicates, joins, ordering and keyset comparisons.

The existing field selector and foreign-key discovery helper cover primary,
belongs-to and polymorphic record/minimal reads. Explicit identity projections
cover visibility, reverse/pivot linkage, include parents, reference cursor values,
target locks, pivot paging, reverse writes and generated INSERT returns. The
parent-map reader now shares this boundary and returns two columns rather than
separate text/native copies of both keys. There is no global driver mutation,
new dependency, query, compatibility layer or public option. The migration guide
explains exact string IDs and the effect on storage hooks.

The shared fixture now matches bigint primary and reference column types. The
first 28 SQLite regressions fail 28/28 before the patch and pass 28/28 afterward;
the canonical run also passes 28/28. Expanded tests cover signed 64-bit endpoints,
adjacent targets, mapped/default IDs, actual window includes, nested/related
reads, both output formats, repeated relationship writes, reverse removal,
borrowed transactions, sparse reference cursors and native numeric ordering.
Generated-ID tests seed above the safe boundary and synchronize PostgreSQL's
sequence before testing actual generated inserts. Their initial four failures
were a fixture incorrectly requiring client-supplied IDs; only the fixture's
explicit generated-ID mode was corrected. The focused native matrix then passes
**192/192** (34 ordinary / 30 canonical per database).

The first broad SQLite selection passes 204/213; nine pivot-read instrumentation
assertions/fault injectors matched the old SELECT text. Updating those matchers
retains their row/binding bounds, exact failures and transaction checks. The
first full gate then passes 4129/4141, with eleven failures and one existing skip:
nine visibility matchers still expected the old projection, and two insert tests
used an incomplete fake Knex function. Visibility matchers now recognize the
identity alias. The insert tests use the shared fixture and a real borrowed
transaction, replacing only the decoded insert result with zero. They verify
both the persisted row and caller-owned rollback. Focused follow-ups pass
12/12 ordinary and 13/13 canonical; their native matrix passes 75/75.

Review of the 10,000-item/20,000-link SQLite plan fixture finds an unnecessary
expression around canonical text IDs. The final visibility projection selects
that known text column directly. Its real EXPLAIN regression fails before and
passes after the refinement. Across 22 canonical plan scenarios, temporary
DISTINCT nodes fall from 30 to zero; statement counts and result assertions are
unchanged. PostgreSQL/MySQL SQL is unchanged by this guard. The ordinary plan
fixture's 22 scenarios also pass. Focused final visibility/bigint tests pass
42/42 canonical. Formatting and repository lint pass before the final freeze.

Final Node 24.6.0 `npm run verify` exits zero:

| Job | Passed | Duration |
| --- | ---: | ---: |
| Full ordinary SQLite | 4140/4141; one existing skip, no failures | 119.406s |
| Full canonical SQLite | 4189/4189; no skips/failures | 95.428s |
| Express 4 ordinary | 355/355 | 9.441s |
| Express 4 canonical | 357/357 | 9.652s |

Type checking, both 44-workload budgets, lint and documentation build pass.
Before the final SQLite-only projection refinement, the broader native selection
passes **3089/3089**, without skips or failures:

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 516/516 | 513/513 | 53.370s / 85.724s |
| PostgreSQL 16.15 | 516/516 | 514/514 | 46.278s / 527.198s |
| MySQL 8.0.46 | 516/516 | 514/514 | 75.678s / 87.640s |

That selection covers bigint/ID contracts, allocation/permission/limit includes,
reference sorting, pivot reads, large identifier lists, temporal conversion and
query budgets. The long PostgreSQL canonical job is observed running an active
query in the 33,000-record fixture with no lock blocker; it completes successfully.
A later attempt to cancel the observed query finds its socket already removed,
so no cancellation occurs. This run is not a latency guarantee.

The **final-source** native matrix covers bigint IDs, visibility, real-transaction
insert fallback and budgets. It exits zero with **276/276**, no skips or failures:

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite | 47/47 | 45/45 | 6.410s / 5.568s |
| PostgreSQL | 47/47 | 45/45 | 18.049s / 48.952s |
| MySQL | 47/47 | 45/45 | 30.615s / 31.734s |

The new public bigint suite follows the actual storage mode; four generated
physical-key tests are ordinary-only. The zero-result fallback suite intentionally
uses ordinary storage in both invocations. Existing suites retain their explicit
fixture scopes. All fourteen budget reports from the broad/final matrices and
final gate match the preceding 44-workload counters. No ceiling is loosened.

The final 266-source manifest matches. The broad matrix's manifest differs only
in the subsequently refined include module and two test files; the final matrix
and full gate cover the final versions. Package/lock, dependency-graph and parked
consumer-patch hashes remain unchanged. Disposable directories Em2wn6, My5OzJ,
CLwZhu and the earlier gcY9BI/dmVVqy runs are removed.

**Next finding: A8-F19 remains open under A2-16.** Included resources can expose
`__$jsonrestapi_computed_deps$__`. Ordinary sparse includes expose even an empty
array; both modes expose dependency field names for an included computed field.
Public GET reproductions fail on the required absence of that member. The same
reproducer against the preceding snapshot yields identical observations. Source
review locates consumption without removal in GET/query enrichment; other
response paths still need regression coverage. This separate bug is not fixed
or counted complete by the bigint work.

Evidence:

- `/tmp/library-bigint-ids-before.log`, `/tmp/library-bigint-ids-first-knex.log`, `/tmp/library-bigint-ids-first-anyapi.log`,
  `/tmp/library-bigint-ids-expanded-knex.log`, `/tmp/library-bigint-ids-generated-knex.log` (regressions and fixture correction).
- `/tmp/library-bigint-ids-first-full-gate.log`, `/tmp/library-bigint-ids-pre-index-gate.log`,
  `/tmp/library-bigint-ids-index-before.log`, `/tmp/library-bigint-ids-index-after.log` (review follow-ups).
- `/tmp/library-bigint-ids-final-gate.log`, `/tmp/library-bigint-ids-final-native.log`,
  `/tmp/library-bigint-ids-final-native-followup.log`, `/tmp/library-bigint-ids-final-native-refinement.log`,
  `/tmp/library-bigint-ids-budget-comparison.log`, `/tmp/library-bigint-ids-final-source.json` (verification and source bounds).
- `/tmp/library-bigint-ids-sqlite-plans-knex.log`,
  `/tmp/library-bigint-ids-sqlite-plans-anyapi.log`,
  `/tmp/library-bigint-ids-sqlite-plans-final-anyapi.log` (plan refinement).
- `/tmp/library-bigint-ids-final-probe.log` (exact public large-ID output).
- `/tmp/library-included-metadata-probe.mjs`, its ordinary/canonical logs and
  `/tmp/library-included-metadata-before-probe.mjs` with its corresponding logs
  (failing regressions for the separate metadata finding).

Documentation is rebuilt after this entry; rendered evidence and migration
content are checked. Consumer checkouts are neither changed nor verified.


## 2026-09-10: Limited include allocation

**82/214 complete (38.3%); 132 open.** Internal work remains 70/138, API work
10/48, migration 2/14 and final review/report 0/14. This corrects **A8-F17**
within **A8-04/A8-07**. Consumer, seed and positioning work remains paused.

Explicit includes no longer perform preliminary collection-linkage reads that
their loaders would replace. Canonical nested traversal passes the current
child include tree to its attachment helpers. Standard many-to-many loaders
select authorized, ordered and limited target records using a SQL membership
subquery before reading parent mappings. Window includes retain their per-parent
queries. Both standard loaders reuse one parent-map reader in the existing
include module; no lifecycle framework, compatibility mode or API option is added.

The shared reader deduplicates IDs, takes at most 100 selected targets per batch,
and pages at most 101 distinct parent/child pairs in native database key order.
It reuses the existing large-parent-predicate helper. Each returned row has text
and native representations of its two IDs: text preserves bigint precision and
safe native numbers preserve references such as SQL `1.0` mapping to ID `"1"`.
The final map necessarily scales with requested linkage. Complete unlimited
includes can require more queries than a former unlimited read; the database
can process more candidate rows than the application receives.

The public canonical 1,001-link probe changes from ten preliminary pages plus
complete include mappings to **zero preliminary pages and 20 mapping rows**,
returning the same 20 links and 20 included resources. The new ordinary fixture
also detects oversized reads before the change (including 339 visible physical
pivot rows for two parents). The final tests retain global/per-parent limits,
sorting, hidden-target filtering, duplicate-edge semantics and callback counts.

The initial 12 regressions reproduce **9 ordinary and 10 canonical failures**;
the first implementation passes 12/12 in both modes. Expanding zero/unlimited
coverage exposes two new test assumptions about an absent empty `included`
member, plus twelve old assertions expecting explicit-include prefetches.
Those expectations are corrected while retaining their payload assertions and
the standalone prefetch paging/failure tests.

Review rejects a draft that crosses parent and target batches: the final reader
requires three reads for 205 one-to-one pairs rather than nine. A target shared
by 205 parents uses 101/101/3-row pages. Repeated 33,000-element inputs collapse
to one read; empty selections issue none. The first fault-injection mock also
intercepted transaction-control strings and contaminated rollback, so those two
focused processes were terminated and the mock was isolated and corrected to
observe the actual transaction client. Owned/borrowed later-page failures now
retain the identical typed error and the expected pending/rolled-back state.

The 64-bit mapping regression initially detects driver rounding. Casting only
to text then exposes two existing nested plain-response checks because SQL
REAL `1.0` no longer matches ID `"1"`. Returning both representations fixes that
regression without rounding unsafe integers. The final focused run passes
**123/123 per mode** (16.277s ordinary / 17.951s canonical), including the 31 new
allocation cases, include permissions and the existing large-identifier suites.
Formatting and repository lint pass before the final 265-file source freeze.

Final Node 24.6.0 `npm run verify` exits zero:

| Job | Passed | Duration |
| --- | ---: | ---: |
| Full ordinary SQLite | 4106/4107; one existing skip, no failures | 133.369s |
| Full canonical SQLite | 4158/4158; no skips/failures | 162.763s |
| Express 4 ordinary | 355/355 | 31.862s |
| Express 4 canonical | 357/357 | 23.596s |

Type checking, both 44-workload budgets, repository lint and documentation build
pass. The selected native runner exits zero with **2310/2310 cases**, no skips
or failures:

| Database | Ordinary invocation | Canonical invocation | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 383/383 | 387/387 | 53.152s / 95.261s |
| PostgreSQL 16.15 | 383/383 | 387/387 | 151.327s / 135.708s |
| MySQL 8.0.46 | 383/383 | 387/387 | 52.821s / 153.678s |

The selection covers include allocation/limits/permissions/failures/batches,
large identifier lists, sparse hydration, canonical prefetch and query budgets.
The 31 new cases follow the invocation's actual storage mode; their 186
executions are included in the total. Existing suites retain their explicitly
fixed storage fixtures, including canonical prefetch in both invocations.
All eight budget reports match: nested includes improve **8/11 to 7/9** and
nested full PATCH improves **15/17 to 14/15** (ordinary/canonical). Their ceilings
are tightened; the other 42 workload counters remain unchanged. All 265 frozen
source hashes, protected package/lock/dependency-graph hashes and the parked
consumer patch match. Temporary directory `/tmp/jra-db-0iRiDV` is removed.

The audit finds **A8-F18**, a separate pre-existing ordinary public-read defect:
SQLite and MySQL can round SQL bigint IDs beyond the JavaScript safe-integer
range before JSON:API serialization, also losing included linkage. PostgreSQL
preserves the exact IDs with matching bigint key/reference columns. Snapshot
comparisons confirm the earlier behavior. An initial probe's mismatched varchar
references were corrected before drawing that native comparison. These are
observational probes, not passing correctness regressions; they force ordinary
storage in both runner modes. The exact new mapping reader cannot recover an
ID rounded by an earlier record-read stage. This needs the next correction.
Full input/output allocation review remains open under A8-07.

Evidence files:

- `/tmp/library-limited-includes-before-knex.log`,
  `/tmp/library-limited-includes-before-anyapi.log` (initial regressions).
- `/tmp/library-limited-includes-key-format-knex.log`,
  `/tmp/library-limited-includes-key-format-anyapi.log` (final focused checks).
- `/tmp/library-limited-includes-final-probe.mjs` and its `.log`
  (limited public include allocation).
- `/tmp/library-limited-includes-updated-budgets.log`,
  `/tmp/library-limited-includes-final-gate.log`,
  `/tmp/library-limited-includes-final-native.log`,
  `/tmp/library-limited-includes-final-source.json` (budgets, gates and hashes).
- `/tmp/library-limited-includes-bigint-before-probe.mjs`,
  `/tmp/library-limited-includes-bigint-probe.mjs`, with their `.log` files,
  `/tmp/library-limited-includes-bigint-matched-native.log`,
  `/tmp/library-limited-includes-bigint-matched-before-pg.log`
  (the separate public-ID finding and matching-column native observations).

Documentation is rebuilt after this entry and rendered evidence, measurement
and migration sections are checked. Consumer checkouts are neither changed nor
verified.


## 2026-09-10: Sparse relationship hydration

**82/214 complete (38.3%); 132 open.** Internal work remains 70/138, API work
10/48, migration 2/14 and final review/report 0/14. This corrects **A8-F16**
within **A8-04/A8-07**. Consumer, seed and positioning work remains paused.

Both storage modes now avoid initial collection-linkage reads for relationships
omitted by the resource's sparse fieldset. The shared final to-one visibility
pass also skips linkage that the response will omit. These changes reuse the
existing fieldset lookup/parser in three runtime files; they add no selection
cache, compatibility mode or API option. Explicit includes still use their
existing loaders, including nested paths through omitted linkage fields.
Selected relationships retain visibility filtering. Attribute dependencies,
primary/included authorization and transaction ownership remain in their existing
lifecycles. The migration guide explains the reduced identifier-query hooks and
the effect on hooks that inspect collection linkage in `context.record`.

The canonical 1,001-link sparse GET now performs **zero parent-link reads**,
down from ten queries reading all 1,001 edges, with the same requested name and
empty relationship object. A separate shared regression seeds 1,001 additional
reverse children and verifies that neither backend reads the omitted collection.
The existing ten-book sparse-query budget improves from **4 ordinary / 5
canonical statements to 1 / 1**; its ceilings are tightened accordingly. The
other 43 workloads retain their statement, result and metadata counters. These
are query-count and intermediate-row measurements, not peak-memory claims.

The final 27-case suite, run against an isolated copy of the preceding 263-file
source snapshot with the same dependencies, reproduces **20 failures in each
mode (7/27 pass)**. It covers empty/repeated fields, computed attributes,
GET/query in JSON:API/plain format, selected collection and to-one linkage,
polymorphic/inverse relationships, nested includes, hidden targets, large omitted
collections, borrowed pending references, and owned/borrowed full-response writes.
Requested-linkage and explicit-include failures still reject; owned writes roll
back and borrowed writes leave completion to their caller.

The initial test draft had two incorrect assumptions: public fieldsets accept
strings, and default include depth is three. Its array-valued fields and a
four-segment include were corrected before the clean snapshot comparison.
No runtime validation was loosened. After expanding the tests, the focused run
passes **310/310 ordinary (8.404s)** and **311/311 canonical (9.007s)** across
the new suite, fieldsets, field dependencies, include permissions and link
prefetch. Lint identified eight property-layout issues in the new test; those
were formatted before the successful final lint and source freeze.

All 264 source files were then frozen. Final Node 24.6.0 `npm run verify`
exits zero:

| Job | Passed | Duration |
| --- | ---: | ---: |
| Full ordinary SQLite | 4075/4076; one existing skip, no failures | 137.635s |
| Full canonical SQLite | 4127/4127; no skips/failures | 149.556s |
| Express 4 ordinary | 355/355 | 19.349s |
| Express 4 canonical | 357/357 | 19.884s |

Type checking, both 44-workload budgets, repository lint and documentation build
pass. The selected native runner exits zero with **2469/2469 cases**, no skips
or failures:

| Database | Ordinary invocation | Canonical invocation | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 411/411 | 412/412 | 13.291s / 19.158s |
| PostgreSQL 16.15 | 411/411 | 412/412 | 71.237s / 74.313s |
| MySQL 8.0.46 | 411/411 | 412/412 | 81.988s / 68.072s |

The native selection adds include failures to the focused selection and query
budgets. The 27 new cases follow each invocation's actual storage mode; their
162 executions are included in the total. The previously added 39 link-prefetch
cases remain explicitly canonical in both invocations. All eight 44-workload
reports match the updated sparse ceilings and otherwise unchanged counters.
Frozen source, package/lock, non-root dependency graph and parked consumer patch
hashes match. Temporary database directory `/tmp/jra-db-bMqhet` is removed.

The follow-up canonical probe confirms **A8-F17**: an explicit include with its
default limit returns 20 links and 20 resources but first prefetches all 1,001
links before replacing that linkage. The standard include loaders also build
complete child-to-parent maps before applying the target result limit. That
remaining allocation work is recorded in the
[measurement review](query-measurements.md#sparse-relationship-hydration); the
ordinary equivalent still needs measurement. A8-07 remains open.

Evidence files:

- `/tmp/library-sparse-hydration-clean-before-knex.log`,
  `/tmp/library-sparse-hydration-clean-before-anyapi.log` (preceding source).
- `/tmp/library-sparse-hydration-focused-knex.log`,
  `/tmp/library-sparse-hydration-focused-anyapi.log` (focused passing runs).
- `/tmp/library-sparse-hydration-final-probe.mjs` and its `.log`,
  `/tmp/library-sparse-hydration-limited-include-probe.mjs` and its `.log`
  (corrected sparse reads and the next allocation finding).
- `/tmp/library-sparse-hydration-updated-budgets.log`,
  `/tmp/library-sparse-hydration-final-gate.log`,
  `/tmp/library-sparse-hydration-final-native.log`,
  `/tmp/library-sparse-hydration-final-source.json` (budgets, gates and hashes).

Documentation is rebuilt after this entry and rendered evidence, measurement
and migration sections are checked. Consumer checkouts are neither changed nor
verified.


## 2026-09-10: Canonical parent-link pages

**82/214 complete (38.3%); 132 open.** Internal work remains 70/138, API work
10/48, migration 2/14 and final review/report 0/14. This corrects **A8-F14** and
**A8-F15** within **A8-07**, which remains open. Consumer, seed and positioning
work remains paused.

The existing canonical parent-link helper now reads at most 101 physical rows
per page, retaining its 100-parent batches. It advances by the physical link ID
and uses the same caller transaction. Complete linkage and duplicate physical
edges remain available; final output still requires memory proportional to its
size. One parent with 1,001 links changes from one 1,001-row query to ten queries
containing at most 101 rows, returning all 1,001 links. Exactly 101 rows require
an empty follow-up query. This measures intermediate row buffers, not peak heap
or end-to-end latency. Linkage follows physical link-ID order; configured include
sorting remains separate. The migration guide records this ordering change.

Both link orientations now constrain the declared target resource as well as
the owner resource, tenant and relationship key. Before the fix, three public
GET regressions return a wrong-type relationship with matching keys. These are
reproduced incorrect-linkage cases, not a claim of an unauthorized-data leak.
The existing related-link query already applies the target-resource constraint;
the prefetch helper now applies the same rule at both call sites.

The new suite passes **39/39** on Node 24 SQLite (1.485s). It covers unpaired,
forward and inverse relationships, mixed physical orientations, exact page
boundaries, duplicate stored edges, repeated parents, tenant/type/key sentinels,
JSON:API/plain GET and query responses, visibility, sparse included fields,
borrowed rollback, and later-page failures during reads and full-response writes.
The existing parent-batch suite passes **4/4** (2.323s); its binding ceilings now
include the target-type predicates and row limit while retaining query counts.

Initial regressions pass 3/27. The first runtime fix passes 23/27; the remaining
four cases expose a fixture omission: its inverse relationship did not receive
the supplied include-limit option. Applying that option consistently in the
shared fixture yields 27/27. An expanded run passes 36/39 because three new tests
incorrectly assume empty IDs are normalized away. Those tests are replaced with
duplicate physical-edge page-boundary cases; runtime ID normalization is unchanged.

After lint, 263 source files were frozen. Final Node 24.6.0 `npm run verify`
exits zero:

| Job | Passed | Duration |
| --- | ---: | ---: |
| Full ordinary SQLite | 4048/4049; one existing skip, no failures | 125.358s |
| Full canonical SQLite | 4100/4100; no skips/failures | 149.504s |
| Express 4 ordinary | 355/355 | 16.453s |
| Express 4 canonical | 357/357 | 26.899s |

Type checking, both 44-workload budgets, repository lint and documentation build
pass. The selected native runner exits zero with **1242/1242 cases**, no skips
or failures:

| Database | Ordinary invocation | Canonical invocation | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 199/199 | 215/215 | 24.563s / 68.875s |
| PostgreSQL 16.15 | 199/199 | 215/215 | 121.136s / 124.682s |
| MySQL 8.0.46 | 199/199 | 215/215 | 42.620s / 80.968s |

The selection covers link prefetch, include batches/limits/adapters, relationship
metadata, related resources and query budgets. The 39 new cases explicitly use
canonical storage in both invocations; their 234 executions are included in the
total, not claimed as ordinary-storage coverage. All eight 44-workload budget
reports retain the counters established after the preceding pivot-read change.
All 263 frozen source hashes, package/lock hashes, the non-root dependency graph
and parked consumer patch match after the gates. Temporary database directory
`/tmp/jra-db-Tm9CGT` is removed.

The next probe confirms **A8-F16**: requesting only `items.name` returns an empty
relationships object yet still performs all ten link-prefetch pages and reads
1,001 rows. The ordinary loader also hydrates relationships unconditionally by
source inspection; that path still needs its own measured regression. Avoiding
unnecessary hydration must account for explicit includes, field dependencies,
visibility and hooks. Full input/output allocation remains part of the open
[allocation review](query-measurements.md#relationship-allocation-review).

Evidence files:

- `/tmp/library-link-prefetch-before.log`,
  `/tmp/library-link-prefetch-scope-before.log` (initial regressions).
- `/tmp/library-link-prefetch-initial.log`,
  `/tmp/library-link-prefetch-fixture-fixed.log`,
  `/tmp/library-link-prefetch-expanded.log` (implementation and fixture checks).
- `/tmp/library-link-prefetch-final-focused.log`,
  `/tmp/library-link-prefetch-parent-batches.log` (focused passing runs).
- `/tmp/library-link-prefetch-final-probe.mjs` and its `.log`,
  `/tmp/library-link-prefetch-sparse-probe.mjs` and its `.log` (row-buffer
  improvement and the remaining sparse-response finding).
- `/tmp/library-link-prefetch-final-gate.log`,
  `/tmp/library-link-prefetch-final-native.log`,
  `/tmp/library-link-prefetch-final-source.json` (final gates and frozen hashes).

Documentation is rebuilt after this entry and rendered evidence, measurement
and migration sections are checked. Consumer checkouts are neither changed nor
verified.


## 2026-09-10: Bounded ordinary pivot reads

**82/214 complete (38.3%); 132 open.** Internal work remains 70/138, API work
10/48, migration 2/14 and final review/report 0/14. This corrects **A8-F12** and
**A8-F13** within **A8-07**; whole input/output allocation and further intermediate
read bounds remain open. Consumer, seed and positioning work remains paused.

Ordinary pivot addition/replacement no longer selects the owner's complete old
membership. Both reuse one private mapping helper and one missing-link insertion
loop in the existing writer. The loop requests at most 100 target IDs and pages
physical pivot rows by their primary key, selecting at most 101 rows at a time.
Duplicate stored edges therefore cannot create an unlimited result buffer. Its
exact-match set retains at most the current batch's requested IDs. It uses the
existing database comparison for unmatched spellings and inserts at most 100
rows per statement. Existing matching pivot IDs and metadata remain unchanged.

Replacement uses one negated predicate for the complete desired set, then the
same missing-link loop. The existing identifier helper handles large parameter
lists. A 33,000-ID test proves all retained pivots survive one exclusion DELETE
and 330 reads; independent keep-list batches would delete wanted links. Empty
replacement has one DELETE and zero pivot reads. The parent/target locks and
caller-owned transaction remain in the existing lifecycle. Actual PostgreSQL and
MySQL contention checks confirm retained and deleted rows stay locked until the
borrower rolls back.

The initial eight regression cases pass **2/8**, reproducing six full-read or
unbounded-result failures. After the first implementation, the combined 18-case
run passes **16/18**; the two failures are old SQL-count expectations for
replacement. Those assertions now expect one complete DELETE plus the existing
bounded insert count. Their retained-row, callback, isolation and rollback checks
remain. Further review adds duplicate physical-edge paging, failure after a
replacement deletion, and large keep-list coverage.

A separate probe confirms a pre-existing alias defect: the previous writer and
the first bounded-read draft both insert two new edges for `BETA` and `beta`
when the target/pivot columns compare those spellings equally. The target-lock
helper already resolves the actual target identity; it now returns each identity
once with the first submitted spelling. Ordinary pivot writers reuse that result.
The tests cover aliases within and across target-lock batches, matching existing
pivot preservation and borrowed rollback. Raw target spelling remains unchanged
for a single submitted ID. This is not an automatic repair of existing duplicate
rows or inconsistent application column collations.

The case-insensitive fixture's first edit did not apply because a replacement
matched more than one fixture block; no fixture source was written by that failed
edit. The following run used the ordinary case-sensitive pivot and reproduced
that mismatched-fixture expectation. The corrected shared fixture explicitly
creates matching target/pivot collations for SQLite, PostgreSQL and MySQL.
Fixtures seed generated pivot IDs instead of forcing IDs into PostgreSQL sequences.

The final new suite passes **20/20** on Node 24 SQLite (4.527s). The preceding
focused run, before its final three cases, passes **51/51** across pivot writes,
reads, target locks and target validation. The final new cases execute again in
the full and native gates. The public one-target measurement improves from
**1,001 returned pivot rows to one**, containing the physical ID and target key
(24 serialized bytes in that fixture). Both addition and replacement verify
pending membership and complete borrowed rollback. This is a selected-row
allocation measurement, not peak memory or latency.

The 101-target ordinary idempotent-add workload intentionally increases from
**9 to 10 SQL statements** because existing-link reads now use two bounded
batches. Its independent ceiling changes from `5 + 2 * B` to `4 + 3 * B`.
The original budget fails before that documented update. All other 43 ordinary
workloads and all 44 canonical workloads retain their statement/result/configuration
counters. The [measurement review](query-measurements.md#ordinary-pivot-membership-reads)
records this tradeoff and the allocations still proportional to input/output.

After formatting, 262 source files were frozen. Final Node 24.6.0
`npm run verify` exits zero:

| Job | Passed | Duration |
| --- | ---: | ---: |
| Full ordinary SQLite | 4009/4010; one existing skip, no failures | 161.000s |
| Full canonical SQLite | 4061/4061; no skips/failures | 112.184s |
| Express 4 ordinary | 355/355 | 14.457s |
| Express 4 canonical | 357/357 | 16.292s |

Type checking, both 44-workload budgets, repository lint and documentation build
pass. The selected native runner exits zero with **696/696 cases**, no skips or
failures:

| Database | Ordinary invocation | Canonical invocation | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 113/113 | 119/119 | 14.333s / 52.593s |
| PostgreSQL 16.15 | 113/113 | 119/119 | 114.308s / 99.110s |
| MySQL 8.0.46 | 113/113 | 119/119 | 77.123s / 87.597s |

The selection includes pivot reads/writes, target-lock batches, target validation,
relationship writes, reused transaction contexts and budgets. The 20 new pivot
cases explicitly use ordinary storage in both invocations; their 120 executions
are included in the total, not claimed as canonical pivot coverage. Canonical
link-batch/target-validation/resource-write cases execute alongside them.
All eight 44-workload budget reports match the updated independent counters.
All 262 source hashes, package/lock hashes, the non-root dependency graph and
the parked consumer patch remain unchanged after the gate. Temporary database
directory `/tmp/jra-db-NdbNfX` is removed.

The next probe confirms **A8-F14**: one canonical parent with 1,001 links still
loads all 1,001 physical link rows in one `fetchLinksForParents` query (seven
bindings), then returns the complete correct linkage. Paging this intermediate
read remains work; final response memory must still scale with visible linkage.
No canonical parent-prefetch source is changed in this batch.

Evidence files:

- `/tmp/library-pivot-reads-before.log`, `/tmp/library-pivot-reads-initial.log`,
  `/tmp/library-pivot-reads-collation.log` (initial regressions and fixture correction).
- `/tmp/library-pivot-reads-identity.log`, `/tmp/library-pivot-reads-final-focused.log`
  (focused passing runs).
- `/tmp/library-pivot-reads-alias-probe.mjs` and its `.log`
  (prior writer versus the initial bounded-read alias defect).
- `/tmp/library-pivot-reads-initial-budgets.log`,
  `/tmp/library-pivot-reads-updated-budgets.log` (measured budget adjustment).
- `/tmp/library-pivot-reads-final-probe.mjs` and its `.log`
  (one-target allocation after correction).
- `/tmp/library-pivot-reads-final-gate.log`,
  `/tmp/library-pivot-reads-final-native.log`,
  `/tmp/library-pivot-reads-final-source.json` (final gates and source hashes).
- `/tmp/library-pivot-reads-link-prefetch-probe.mjs` and its `.log`
  (next canonical allocation finding).

Documentation is rebuilt after this entry and rendered evidence, measurement
and migration sections are checked. Consumer checkouts are neither changed nor
verified.


## 2026-09-10: Plain conversion lookup

**82/214 complete (38.3%); 132 open.** Internal work remains 70/138, API work
10/48, migration 2/14 and final review/report 0/14. This corrects **A8-F11**
within **A8-07**. Whole input/result memory and ordinary whole-membership reads
remain open. Consumer, seed and positioning work remains paused.

Plain conversion previously scanned the included array for every expanded
reference. It now builds one nested type/ID map for the document and shares it
across primary records and recursive expansion. The first duplicate identity
wins; numeric/string IDs and delimiter-containing keys remain separate. The
map holds input references only for this call. Branch-local cycle tracking,
independent sibling output, polymorphic types and direct single-resource calls
keep their existing behavior. No public option, retained row cache or dependency
is added. Source search found no existing included-record indexing helper to
reuse in this converter.

The converter suite grows from five to 13 cases. Before the runtime correction,
its two deterministic lookup-work cases fail while the other ten then-present
cases pass. The final suite additionally checks null/missing included data.
The first public GET/query tests incorrectly expected a reverse cycle after
requesting only `mentions.group`. Include metadata initializes that unrequested
collection empty. Requesting the intended full `mentions.group.items` path
corrects the fixture; no converter change was needed for those two failures.
The corrected focused run passes **15/15 ordinary** (0.633s) and **15/15
canonical** (0.698s), including a 1,500-child public fixture, sparse fields,
query-hidden targets and cycle references.

At 1,000/5,000/10,000 included children, the instrumented lookup probe now
observes **3,000/15,000/30,000** type reads, compared with
**501,500/12,507,500/50,015,000** before. The standalone ordinary-object benchmark
uses one warm-up and five timed conversions per size. Median times change from
**9.736/82.309/361.120ms** to **1.786/7.613/11.191ms** on Node 24.6.0. Setup and
full-output assertions are outside the measured intervals. These are converter
measurements, not request latency or peak heap. The new map requires references
proportional to unique included identities; complete output and recursive branch
expansion can still consume substantial memory. See the
[measurement and limits](query-measurements.md#plain-conversion-lookup).

After formatting, all 261 source files were frozen before the final gate and
benchmark. Node 24.6.0 `npm run verify` exits zero:

| Job | Passed | Duration |
| --- | ---: | ---: |
| Full ordinary SQLite | 3989/3990; one existing skip, no failures | 138.141s |
| Full canonical SQLite | 4041/4041; no skips/failures | 122.264s |
| Express 4 ordinary | 355/355 | 17.328s |
| Express 4 canonical | 357/357 | 19.379s |

Type checking, both 44-workload query budgets, repository lint and documentation
build pass. The selected native runner exits zero with **2,028/2,028 cases**,
no skips or failures:

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 330/330 | 346/346 | 32.255s / 93.785s |
| PostgreSQL 16.15 | 330/330 | 346/346 | 98.286s / 108.337s |
| MySQL 8.0.46 | 330/330 | 346/346 | 35.473s / 70.275s |

The selection includes the new public plain fixture, formats, fieldsets,
include adapters/permissions/batches, pagination, related endpoints and query
budgets. It also repeats the 13 database-independent converter cases in each
job; those 78 executions are part of the total above, not additional database
coverage. All eight 44-workload reports match the retained statement, result
and configuration counters. All 261 frozen source hashes match after the gates.
Package/lock hashes, the non-root dependency graph and the parked consumer patch
remain unchanged. Native temporary directory `/tmp/jra-db-QaK7nF` is removed.

The next allocation probe confirms **A8-F12**: ordinary relationship addition
and replacement read all 1,001 existing pivot IDs when supplied just one linked
ID. Both public operations preserve the expected pending membership and all
original rows after borrowed rollback. Those writers are unchanged in this
batch. A8-07 remains open for their bounded-read correction and broader memory
work; the [allocation review](query-measurements.md#relationship-allocation-review)
records the evidence and required semantics.

Evidence files:

- `/tmp/library-plain-lookup-before-tests.log`,
  `/tmp/library-plain-lookup-focused-knex.log`,
  `/tmp/library-plain-lookup-focused-anyapi.log` (initial regression/fixture failures).
- `/tmp/library-plain-lookup-cycle-knex.log`,
  `/tmp/library-plain-lookup-cycle-anyapi.log` (corrected focused runs).
- `/tmp/library-plain-lookup-before-benchmark.json`,
  `/tmp/library-plain-lookup-final-benchmark.json` (ordinary-object timing).
- `/tmp/library-plain-lookup-final-gate.log`,
  `/tmp/library-plain-lookup-final-native.log`,
  `/tmp/library-plain-lookup-final-source.json` (final gates and frozen source).
- `/tmp/library-plain-lookup-pivot-read-probe.mjs` and its `.log`
  (next allocation finding).

Documentation is rebuilt after this entry and the rendered evidence,
measurement and migration content is checked. No consumer checkout is changed
or verified.


## 2026-09-10: Reverse linkage projections and allocation review

**82/214 complete (38.3%); 132 open.** Internal work remains 70/138, API work
10/48, migration 2/14 and final review/report 0/14. This advances **A8-07**;
its whole-input/result allocation requirements remain open. Consumer, seed
and positioning work remains paused.

**A8-F10 is corrected.** Canonical reverse hasMany/hasOne and polymorphic
linkage previously loaded complete target records, including all text/JSON
slots, then used only identity and parent reference. Two selections in the
existing helper now fetch those qualified columns. The physical ID remains
selected for the existing logical-ID fallback. Filters, scoped predicates,
replacement builders and transaction ownership keep their existing path.
Ordinary linkage already selects its two necessary columns.

The shared seven-case `conformance-linkage-projections.test.js` covers JSON:API
and plain GET/query results, selected widths/bytes, a replacement filtering
builder, canonical tenant/resource sentinels, borrowed pending references and
rollback, and failure propagation. Its first ordinary run passes **7/7**.
The first canonical run reproduces the full-row problem once, then six fixture
setups fail because foreign-tenant/resource sentinels were not cleared by the
normal resource reset. Their explicit fixture cleanup corrects that test issue.
The isolated pre-fix measurement reproduces the width failure independently.
After the source correction and fixture fix, the final new suite passes **7/7
ordinary** (0.312s) and **7/7 canonical** (0.346s).

For 20 children with large JSON attributes and one hidden child, the canonical
GET's three linkage queries return 19, 19 and 1 rows. Their width drops from
52 columns to 3, and total serialized result bytes drop from **409,543 to
1,650**. These are Node 24 SQLite query-result measurements, not peak heap or
network bytes. The same narrow-column/result assertions pass on PostgreSQL and
MySQL. The [allocation review](query-measurements.md#relationship-allocation-review)
records the exact per-query values and allocations still proportional to input,
edge or output size.

The final Node 24.6.0 `npm run verify` exits zero: **3979/3980 ordinary**
(one existing skip, 86.430s), **4031/4031 canonical** (101.751s), Express 4
**355/355 ordinary** (12.088s) and **357/357 canonical** (11.603s). Type checking,
both 44-workload query budgets, repository lint and documentation build pass.

The selected native matrix exits zero with **1,152/1,152 cases**, no failures
or skips. It includes 42 executions of the new projection cases, stored
relationship metadata, descriptor transactions, related endpoints, include
limits, 33,000-parent collection ID lists and query budgets.

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 192/192 | 192/192 | 11.617s / 38.339s |
| PostgreSQL 16.15 | 192/192 | 192/192 | 67.277s / 241.206s |
| MySQL 8.0.46 | 192/192 | 192/192 | 25.287s / 35.126s |

The longer PostgreSQL canonical job was checked against its live process and
allowed to finish; it was not restarted. All eight 44-workload budget reports
match the retained statement/result/configuration counters. All 259 frozen
source hashes match after the gates. Package/lock hashes, the non-root dependency
graph and the parked consumer patch remain unchanged. Native temporary directory
`/tmp/jra-db-zOZf4Y` is removed. Documentation is rebuilt after this entry and
the rendered evidence/allocation/migration anchors are checked.

The independent allocation inspection reproduces **A8-F11**, still open:
plain conversion calls `included.find` for every expanded relationship reference.
The instrumented probe observes 501,500/12,507,500/50,015,000 included-type reads
for 1,000/5,000/10,000 children, despite a linear-size output. Instrumented timing
is descriptive and includes accessor overhead. The next change should remove
that repeated search with one conversion-local lookup while preserving strict
type/ID identity, first-match behavior, independent sibling expansion and cycle
handling. No plain-conversion source is changed in this batch.

The [migration guide](../GUIDE/MIGRATING_API_V2.md#stored-relationship-metadata)
explains the narrower identifier query selections; no payload/data migration
or caller option is added. Full linkage still grows with visible edges. This
correction does not establish a constant memory bound for complete responses.

Evidence uses `/tmp/library-linkage-memory-`: `before-{knex,anyapi}.log`,
`measured-before.log`, `focused-{knex,anyapi}.log`,
`final-focused-{knex,anyapi}.log`, `final-lint.log`, `final-gate.log`,
`final-native.log`, `final-docs.log` and `plain-scan-probe.json`.
The formatted manifest is `final-source.json` (259 files); starting copies
are `/tmp/library-linkage-memory-start-54f87byd`.

## 2026-09-10: Query plans and SQLite ordering

**82/214 complete (38.3%); 132 open.** Internal work is 70/138, API work 10/48,
migration 2/14 and final review/report 0/14. **A8-10 is complete.** Consumer,
seed and positioning work remains paused.

The new `scripts/measure-query-plans.js` seeds 10,000 items, 100 groups and
20,000 links in the existing query-conformance fixture. Eleven public operation
shapes run before and after candidate indexes, including nullable sorting and
cursor boundaries, sparse/flat pages, selective filtering, related counts,
nested includes, and replacement/removal across the 100-ID batch boundary.
The script checks results and explains the actual SQL captured from Knex;
write scenarios verify pending membership and roll back. EXPLAIN does not use
ANALYZE. Reports omit SQL/bound values/conditions and distinguish optimizer
estimates from actual execution measurements. Both modes run on each database.

The first script draft used `filter` instead of programmatic `filters`; both
ordinary and canonical validation correctly rejected it. The first native
attempt then exposed a script mistake: query events contain PostgreSQL driver
placeholders, which cannot be rebound as Knex `?` placeholders. The tool now
uses Knex's existing client connection/query path with those driver bindings.
The corrected before-change native run exits zero with all six script jobs
passing, each containing 22 checked operations (11 shapes in two index phases).

Existing canonical relationship/resource prefixes omit the selected owner ID.
The tested owner indexes improve corresponding reads/deletes on the populated
fixture; reference and ordinary pivot indexes also improve matching lookups.
Not every statement selects a candidate, and several scans/sorts remain.
The [review](query-plans.md) records concrete recommendations through authored
resource indexes and the existing Knex migration path, with slot mappings,
MySQL key width and write/storage costs to consider. Runtime schema creation
is unchanged; no application index or new indexing API is added automatically.

The plan review reproduces **A8-F09**: SQLite's `IS NULL` ordering expression
forces a full temporary sort even for ID pagination and an indexed nullable
rank. The two existing order helpers now use native SQLite null placement,
with a fixed normalized direction and retained projection bindings. The final
plans eliminate the ID-page sort. Candidate rank-index scans replace the full
sort with a sort of the last ID term within rank groups, in both directions
and at the measured cursor boundary. PostgreSQL/MySQL ordering SQL is unchanged.
SQLite's supported engine must be at least 3.30; the verified driver uses 3.49.2.

The new ten-case `conformance-sort-indexes.test.js` checks stored and projected
values in both directions with nulls first/last, expression bindings, index
use and public ID pagination. Before the correction it passes five controls
and fails five plan assertions in each mode. The first runtime correction
preserves all tested results and removes the ID sort, but four assertions still
incorrectly require removal of the partial ID-tie sort too. A direct SQL probe
confirms that residual step. Those assertions now require use of the rank index
and absence of a full-input sort, matching the implemented improvement; the
remaining partial sort is documented explicitly.

The final Node 24.6.0 `npm run verify` exits zero: **3972/3973 ordinary**
(one existing skip, 96.444s), **4024/4024 canonical** (121.333s), Express 4
**355/355 ordinary** (13.094s) and **357/357 canonical** (14.131s). Type checking,
both 44-workload query budgets, repository lint and documentation build pass.

The final selected native run exits zero with **1,890/1,890 cases**, no failures
or skips. It includes 60 executions of the new ordering regressions, six plan
script jobs, and query/pagination/hidden-sort/include-limit/visibility/reference-
sort/cursor-contract regressions plus the budget runner. Each plan script job
checks all 22 operations; these operations are not counted as additional node
test cases in the totals below.

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 316/316 | 314/314 | 24.602s / 55.284s |
| PostgreSQL 16.15 | 316/316 | 314/314 | 101.671s / 85.322s |
| MySQL 8.0.46 | 316/316 | 314/314 | 35.678s / 61.378s |

All eight budget reports match the retained statement/result/configuration
counters. In every plan report, adding candidate indexes leaves each operation's
statement count unchanged. Timing samples include cache warming and scheduling;
they do not establish a universal speedup. Structural plan improvements justify
the SQLite correction and workload-specific index recommendations. Other query
shapes, production distributions, peak memory and consumer performance remain
under their separate open items.

All 258 frozen source hashes match after both gates. Package/lock hashes, the
non-root dependency graph and the parked consumer patch are unchanged. Native
temporary directory `/tmp/jra-db-lTviiP` is removed. The migration guide explains
the SQLite engine requirement and unchanged payload/cursor contract. Documentation
is rebuilt after this entry, and the rendered review/evidence/migration anchors
are checked. No consumer checkout is modified or verified.

Evidence uses `/tmp/library-query-plans-`: `first-{knex,anyapi}.log`,
`second-{knex,anyapi}.log`, `first-native.log`, `before-native.log`,
`sort-before-{knex,anyapi}.log`, `sort-after-{knex,anyapi}.log`,
`final-lint.log`, `final-gate.log`, `final-native.log` and `final-docs.log`.
The formatted manifest is `final-source.json` (258 files); starting copies
are `/tmp/library-query-plans-start-6eqdm622`.

## 2026-09-10: Metadata cache retention and correctness

**81/214 complete (37.9%); 133 open.** Internal work is 69/138, API work 10/48,
migration 2/14 and final review/report 0/14. **A8-09 is complete.** Consumer,
seed and positioning work remains paused.

The review keeps the existing published resource metadata, compiled cursor
contracts and invocation-local lookup maps. Their measured reuse does not need
a second schema system or cached permission results. Three local changes address
retention and correctness in the existing mechanisms:

- Canonical registry reads, registration and field allocation share a small
  insertion helper that retains at most 100 recently used descriptors. Hits
  refresh recency and return clones. Borrowed transactions do not publish or
  reorder committed entries. A refresh confirming a missing descriptor now
  removes its stale entry; read failures are not interpreted as absence.
- The single request-contract cache key now includes resource name. Deep callers
  reusing a compiled field definition object under another resource name receive
  the correct JSON:API type contract. This regression does not establish a leak
  between normally registered resources, which have distinct compiled owners.
- Temporal normalization retains only the five built-in temporal types with
  default or integer precision 0–6: at most 40 contracts. Other declarations
  still validate, using an uncached contract. No precision clamp or new option
  is introduced.

The new `conformance-metadata-cache.test.js` has 13 cases: contract identity over
100 payloads, name/configuration changes, 130 tenant/resource descriptor pairs,
read/write publication bounds, recency, clones, invalidation, borrowed deletion
and rollback, negative lookups, confirmed removal, public work after eviction,
and repeated common/unusual temporal precision through 10,000. The registry
suite explicitly uses canonical storage even in ordinary-mode jobs. A cache hit
uses zero SQL; reloading an evicted descriptor uses three statements on every
tested database. A resource write after eviction retains the same published
descriptor and performs zero configuration-table queries.

The first 12-case draft passed 7 and failed 5 in each storage mode. Four failures
reproduced cache name/retention defects; one test incorrectly expected time
precision not to pad fractional digits and was corrected. A separate two-case
refresh probe passed one control and reproduced stale metadata after confirmed
removal. Focused metadata/registry/cursor verification then passed **72/72 in
each storage mode**. After the final built-in-type cache restriction and exact
reload-query assertions, the new suite passes **13/13** and is included in the
full and native gates below.

The Node 24.6.0 `npm run verify` log records all stages completing successfully:
**3962/3963 ordinary** (one existing skip, 87.315s), **4014/4014 canonical**
(101.704s), Express 4 **355/355 ordinary** (11.661s) and **357/357 canonical**
(12.980s). Type checking, both 44-workload query budgets, repository lint and
documentation build pass. The selected native matrix records **1,802/1,802
cases**, no failures/skips, including 78 executions of the new suite. It also
covers registry failures, descriptor transactions, field evolution, schema
enrichment, temporal values and the budget runner.

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 290/290 | 310/310 | 7.857s / 25.203s |
| PostgreSQL 16.15 | 290/290 | 311/311 | 54.222s / 73.341s |
| MySQL 8.0.46 | 290/290 | 311/311 | 47.195s / 49.356s |

All eight budget reports (two full-gate and six native) match the retained
44-workload statement/result/configuration counters. A concurrent cursor
benchmark reports a 130.391ms median for five rounds of 10,000 four-field
validations. This is descriptive only; the earlier isolated before/after result
is the evidence for keeping that cache. Neither measurement establishes peak
heap use or application throughput. The temporal retention bound follows from
the finite cache-key predicate, not inspection of private cache memory.

All 256 frozen source hashes match after the gates. Package/lock hashes, the
non-root dependency graph and the parked consumer patch are unchanged. Both
verification processes finish and `/tmp/jra-db-TUZEU4` is removed. The
[cache inventory](compiled-resources.md#cache-ownership-and-invalidation),
[measurement review](query-measurements.md#metadata-cache-retention) and
[migration guide](../GUIDE/MIGRATING_API_V2.md#schema-migration-helpers) explain
retention and publication. Documentation is rebuilt after this entry and the
rendered anchors are checked. Whole-response memory, mutable configuration and
query plans remain separate open criteria; registry eviction may increase
explicit lookup traffic and does not limit registered resource count.

Evidence uses `/tmp/library-metadata-cache-`: `before-{knex,anyapi}.log`,
`refresh-before.log`, `focused-{knex,anyapi}.log`, `final-focused.log`,
`final-lint.log`, `final-gate.log`, `final-native.log`,
`cursor-benchmark.json` and `final-docs.log`. The formatted manifest is
`final-source.json` (256 files); starting copies are
`/tmp/library-metadata-cache-start-w44btqry`.

## 2026-09-10: Collection filtering and authorization review

**80/214 complete (37.4%); 134 open.** Internal work is 68/138, API work 10/48,
migration 2/14 and final review/report 0/14. **A8-08 is complete.** The review
covers collections, related endpoints, includes, search/sorting, batched
linkage/validation and metadata caches. Consumer, seed and positioning work
remains paused.

Both collection storage helpers discarded a replacement assigned by a
`knexQueryFiltering` hook. A visibility restriction added only to that replacement
could be absent from returned records. Ordinary counts honored their separate
replacement, producing totals inconsistent with the page; canonical pages and
totals both missed the restriction. Each helper now uses the final filtered
builder. A `try/finally` restores the previous `context.knexQuery` after filtering
succeeds or fails, matching the existing single-record/include behavior. This
uses the existing query/context mechanism and introduces no lifecycle framework.

The new `conformance-query-visibility.test.js` has 18 cases. It checks offset and
forward/backward cursor results for direct, hasMany-related and many-to-many
collections in both formats, sparse SQL projections, per-parent include limits,
single-record visibility, caller-context reuse, borrowed changes/rollback, and
query-metadata restoration. Before the fix each storage mode passes 3 controls
and fails 15 cases. After the runtime fix, six tests still assumed an unavailable
cursor `prev` field/link; the tests now use the documented `page.before` boundary.
The final focused runs pass **18/18 ordinary** (0.808s) and **18/18 canonical**
(0.935s), with no skips.

The [authorization review](query-measurements.md#authorization-before-limits-and-counts)
maps each guarantee to its implementation and existing regression suites. SQL
policies/autofilters run before limiting or counting candidate rows; collection,
include/search target and pivot permissions are checked at their respective
entry points. Visibility/include/search maps are local to the call. Adapter
caches store schema mappings within one API. Registry descriptors use complete
tenant/resource tuple keys, are cloned on return and are not published from
borrowed transactions. Existing tests switch callers, roll back visibility,
reuse IDs across tenant APIs, and exercise delimiter-containing cache keys.

Registry implementation/schema/helper hashes and both registry-failure and
descriptor-transaction test hashes still match
`/tmp/library-published-descriptor-final-source.json`. Their prior 1,780-case
native evidence remains linked under
[published descriptor verification](#2026-09-10-published-descriptors-and-query-measurements).
The current full suites also execute those tests. The selected native run for
this review covers query visibility, authorization, include permissions/limits,
search authorization, reference sorting, visibility batches, target validation
and query budgets.

The Node 24.6.0 `npm run verify` gate exits zero: **3949/3950 ordinary** (one
existing skip, 97.550s), **4001/4001 canonical** (137.328s), Express 4
**355/355 ordinary** (17.930s) and **357/357 canonical** (19.229s). Type checking,
both 44-workload query budgets, repository lint and documentation build pass.
All existing budget statement/result/configuration counters remain unchanged.

The selected native matrix exits zero with **2,514/2,514 cases**, including
108 executions of the new suite and six 44-workload budget checks, with no
failures or skips. All six budget reports retain the baseline counters.

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 418/418 | 420/420 | 18.496s / 50.495s |
| PostgreSQL 16.15 | 418/418 | 420/420 | 120.394s / 108.233s |
| MySQL 8.0.46 | 418/418 | 420/420 | 42.299s / 56.760s |

All 255 frozen source hashes match after both gates. Package/lock hashes, the
non-root dependency graph and the parked consumer patch are unchanged. The
native runner removes `/tmp/jra-db-2F9Z0M`. Documentation is rebuilt after this
entry and the rendered evidence/review/migration anchors are checked.

The [migration guide](../GUIDE/MIGRATING_API_V2.md#collection-filtering-hooks)
describes honored replacements, retained scope predicates and context restoration.
Ordinary counts still run filtering hooks separately; canonical counts clone the
filtered collection query. This correction adds no public option or schema
migration and preserves that existing callback contract. The native claims use
the [documented drivers/collations](real-databases.md), not arbitrary database
configuration or permissions implemented only in response callbacks.

Evidence uses `/tmp/library-query-visibility-`: `before-{knex,anyapi}.log`,
`after-{knex,anyapi}.log`, `focused-{knex,anyapi}.log`,
`final-focused-{knex,anyapi}.log`, `final-lint.log`, `final-gate.log` and
`final-native.log` and `final-docs.log`. The formatted source manifest is `final-source.json`
(255 files); starting copies are `/tmp/library-query-visibility-start-c4g4ax8t`.

## 2026-09-10: Canonical relationship deletion and replacement

**79/214 complete (36.9%); 135 open.** Internal work remains 67/138, API work
10/48, migration 2/14 and final review/report 0/14. This advances A8-04/A8-07;
their broader acceptance conditions remain open. Consumer, seed and positioning
work stays paused.

Canonical removal now deduplicates supplied IDs and deletes at most 100 of them
per statement, without reading the owner's complete membership. Replacement
adds missing links using bounded existing-link reads, then removes unwanted
links with one complete keep-list predicate. Empty replacement needs no link
read and one DELETE. The existing large-ID helper handles SQLite/PostgreSQL
parameter limits; a 33,000-ID replacement verifies that batching cannot erase
another portion of the requested set.

The shared mutation predicate constrains tenant, owner, relationship and target
resource in both stored directions. This also fixes deletion of another target
resource with a reused ID and incomplete replacement when inverse metadata is
missing. Listing reuses the existing related-ID query so another resource type
cannot shadow a valid target. Two local identity/map helpers are removed.

Review caught an intermediate regression: replacement attached all requested
IDs, but the old attachment lookup recognized only the expected canonical
orientation. A retained link created before its inverse declaration could gain
a duplicate. Both new orientation cases failed with three rows instead of two.
Attachment now reads both stored directions, preserves the existing ID/payload,
and repairs missing inverse metadata according to the actual row orientation.
Database comparison determines the owner side; unmatched ID spellings retain
the existing scoped comparison against database collation. Inserts remain
individual operations and batch results are not cached across calls.

The 40 new cases use canonical storage explicitly in both mode jobs. They cover
unpaired and both paired directions, 205 distinct IDs, 33,000 repeated IDs,
empty removal/replacement, overlapping resource IDs, tenant/relationship scope,
payload/row preservation, missing inverse metadata, opposite stored orientation,
actual delete locks, owned rollback and borrowed pending changes after a later
deletion failure. The 33,000-distinct-ID case exercises the storage replacement
directly; public relationship calls are exercised by the smaller cases.

The initial 35-case run has 15 passes and 20 failures, including query-budget
expectations and one fixture error from inserting too many seed rows at once.
That fixture now seeds bounded chunks. Three separate listing regressions fail
before the listing fix. A subsequent 38-case pass precedes the two failing
orientation regressions. After the final fix and formatting, the new suite plus
relationship batching and target validation pass **70/70** on Node 24.6.0
(12.987s, no skips).

The Node 24.6.0 `npm run verify` gate exits zero. Full suites pass **3931/3932
ordinary** (one existing skip, 124.005s), **3983/3983 canonical** (151.586s),
and Express 4 **355/355 ordinary** (20.022s), **357/357 canonical** (25.985s).
Type checking, both 44-workload budgets, repository lint and the documentation
build pass. All statement/result/configuration counters in those existing
workloads remain identical to the target-validation baseline. These fixtures
do not measure every full-replacement shape: retaining a large membership now
uses batched target locks and existing-link reads, increasing round trips over
the former single unbounded membership read. A8-10/A8-12 retain that query-plan
and broader measurement work.

Native SQLite/PostgreSQL/MySQL verification also exits zero: **660/660 cases**,
including 240 executions of the new 40-case suite, with no skips or failures.
The selected files cover canonical deletion/replacement, relationship batching,
target validation, relationship writes/concurrency, and the query-budget runner.
All six native 44-workload runs retain the same counters as the baseline.

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 107/107 | 113/113 | 26.938s / 51.200s |
| PostgreSQL 16.15 | 107/107 | 113/113 | 67.969s / 101.997s |
| MySQL 8.0.46 | 107/107 | 113/113 | 106.072s / 54.304s |

All 254 formatted source hashes match after verification. Package/lock hashes,
the non-root dependency graph and parked consumer patch are unchanged. The
native runner removes `/tmp/jra-db-IyWblv`. Documentation is rebuilt after this
entry and its rendered anchors are checked.

The [query notes](query-measurements.md#canonical-relationship-deletion-and-replacement)
explain the measured changes and remaining work. The
[migration guide](../GUIDE/MIGRATING_API_V2.md#review-relationship-writes)
documents SQL instrumentation/lock changes and preservation of existing link
rows; this change needs no call-site or schema migration.

Evidence files use `/tmp/library-canonical-deletes-`: `before.log`,
`list-before.log`, `orientation-before.log`, `preflight.log`,
`fixed-focused.log`, `final-gate.log` and `final-native.log`. The formatted
source manifest is `final-source.json` (254 files); starting copies are
`/tmp/library-canonical-deletes-start-44i81dmx`. Changes remain in the existing
working tree.

## 2026-09-10: Batched relationship target validation

**79/214 complete (36.9%); 135 open.** Internal work is 67/138, API work 10/48,
migration 2/14 and final review/report 0/14. **A8-06 is complete.** This joins the
previous include/collection corrections with batched write-target validation.
A8-04/A8-07 and consumer performance/migration evidence remain open. Consumer,
seed and positioning work stays paused.

The existing `validateRelationshipAccess` and storage `dataGetMinimal` helpers
now read up to 100 distinct targets per batch. Complete row predicates run on
each batch; read permission hooks receive each target's ID and minimal record,
in input order, once per distinct identifier within each relationship. There
is no permission-result cache across calls or relationships. A scoped single-ID
lookup retains actual database equality when a returned ID has another spelling.

Filtered IDs form a subquery in the same statement that selects the minimal
rows. Both selections retain canonical tenant/resource constraints. This avoids
row multiplication from policy joins and equality comparisons over JSON-valued
attributes. Minimal rows are discarded after each batch; the complete input ID
sets still grow with the payload. The single-record helper path keeps its result
shape; no new normalization or lifecycle framework was added.

Many-to-many storage no longer repeats a full GET after payload validation. The
POST relationship endpoint now uses that same validation step before storage.
Target locks and existence checks remain; storage writers do not authorize a
payload independently. The [migration guide](../GUIDE/MIGRATING_API_V2.md#relationship-target-validation)
explicitly moves link authorization out of response GET/getter/computed/finish
hooks and into the existing permission hook. It explains batch SQL context and
duplicate handling. Consumer ports are not claimed complete.

The unchanged 44-workload fixture demonstrates the reduction:

| Existing targets added | Ordinary before / after | Canonical before / after |
| --- | ---: | ---: |
| 1 | 10 / 7 | 11 / 7 |
| 10 | 51 / 7 | 61 / 7 |
| 40 | 186 / 7 | 226 / 7 |
| 101 | 461 / 9 | 563 / 10 |

Hidden-target rejection at size 101 falls from 459/560 to 7/7. All result,
included-record and configuration-query counters stay unchanged. Only the eight
relationship-authorization measurements per mode change statement counts; the
other 36 remain identical. Their enforced ceilings are reduced accordingly.
All six native runs match these counters, as do the post-formatting budget runs.

The new suite has 19 shared cases and one canonical-only tenant case. It covers
205-target POST, PUT-create/update, PATCH and relationship additions; exact
permission order/counts, repeated IDs, overlapping resource IDs, actual result
batches of 100/100/5 despite duplicate joins, JSON-valued targets, hidden/missing
targets, later query/permission/finish failure, borrowed pending data and rollback,
two real canonical tenants and actual case-insensitive ID comparison. The
collation case explicitly uses ordinary storage in both mode jobs.

Before implementation, the original 15-case ordinary suite had 14 failures and
one pass under the newly selected contract. Initial broad verification then
exposed 36 tests expecting retired target response callbacks and two pivot tests
tracing `finishGet`. Permission tracing now uses `checkPermissions`. The 36
getter/computed failure cases now request full write responses with included
targets; four additional cases prove relationship replacement does not invoke
those callbacks. Existing error/rollback assertions remain. Interim test fixes
supplied complete PUT payloads, selected `api.helpers` for the tenant probe, and
stopped expecting unchanged top-level write context; these are not library
findings.

The final native run passes **2,616 cases**, without failures, cancellations or
skips. It includes the new suite, relationship/pivot batching, reverse writes,
authorization, bulk authorization, transaction context, field callback failures
and the query-budget runner. There are 117 executions of the new cases and six
44-workload budget checks within this run.

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 433/433 | 439/439 | 20.445s / 47.075s |
| PostgreSQL 16.15 | 433/433 | 439/439 | 89.913s / 84.537s |
| MySQL 8.0.46 | 433/433 | 439/439 | 52.451s / 76.486s |

The Node 24.6.0 full suites pass **3891/3892 ordinary** (one existing skip,
80.875s), **3943/3943 canonical** (102.181s), Express 4 **355/355 ordinary**
(15.619s) and **357/357 canonical** (16.231s). That `npm run verify` invocation
then stops at 34 formatting errors; it is not recorded as an exit-zero gate.

All 253 frozen source hashes match after the native run. Formatting fixes then
change three files: line breaks and braces around one expression statement.
Parsed syntax is compared before/after, allowing that equivalent single-statement
block. The changed functional test files pass again on the formatted source:
**243/243 ordinary** (7.313s), **244/244 canonical** (8.834s), with no skips.
Type checking, both 44-workload budgets and repository lint then exit zero.
Documentation is rebuilt after this entry. The full/native results above refer
to the verified pre-formatting source, with this explicit formatting-only delta.

Package/lock hashes, the non-root dependency graph and parked consumer patch are
unchanged. Both native runners remove their disposable directories
(`/tmp/jra-db-0ZGx0A` and `/tmp/jra-db-WaUsEy`). Changes remain in the existing
working tree. Evidence: `/tmp/library-target-validation-before-knex.log`,
`/tmp/library-target-validation-initial-{gate,native}.log`,
`/tmp/library-target-validation-final-{gate,native,docs}.log`,
`/tmp/library-target-validation-formatted-{knex,anyapi,checks}.log` and
`/tmp/library-target-validation-format.{mjs,json,log}`. Manifests are
`/tmp/library-target-validation-{final,formatted}-source.json`; starting copies
are `/tmp/library-target-validation-start-o_rkqle_`. See
[target validation and remaining work](query-measurements.md#relationship-target-validation).

## 2026-09-10: Single-query collection identifier lists

**78/214 complete (36.4%); 136 open.** Internal work remains 66/138, API work
10/48, migration 2/14 and final review/report 0/14. This fixes A8-F07. Broader
memory and per-target validation work keeps A8-04/A8-06/A8-07 open. Consumer,
seed and positioning work remains paused.

A shared 19-line `whereInIdentifiers` helper deduplicates IDs and preserves one
collection query. Lists above the existing 100-ID threshold use one array
parameter on PostgreSQL or one JSON-array parameter through SQLite's `json_each`.
Fourteen ordinary/canonical collection and relationship-metadata predicates now
use it. Existing SQL sorting, global/per-parent limits, permissions, projections
and callback frequency remain in place. There is no new API option or
compatibility path. The [migration guide](../GUIDE/MIGRATING_API_V2.md#large-collection-identifier-queries)
explains the query-builder shape change and SQLite JSON1 requirement.

MySQL retains Knex's existing text-protocol `IN`. A real MySQL probe accepted
100,000 supplied IDs. An alternative JSON-table comparison incorrectly matched
both adjacent SQL bigint values when only one was requested; native `IN`
returned the correct row. The retained regression covers this precision risk.
Statement/packet limits still apply, and the full deduplicated input, array/JSON
binding and response still scale with collection size. This is not a total
request-memory bound.

Before integration, the eight-case suite produced seven passes/one failure in
ordinary storage and five passes/three failures in canonical storage. The public
33,000-parent include failed with SQLite's parameter error in both modes. Two
canonical test expectations incorrectly passed numbers for stored text IDs;
both the existing `IN` and the new form returned no rows. Those tests were
corrected to supply the actual storage ID types, without adding runtime coercion.

The final eight retained cases cover:

- Large-list filtering, sorting and limits; empty/repeated IDs; SQL aliases and
  subqueries; uncommitted reads without completing a borrowed transaction.
- Quoted/Unicode IDs, leading zeros, real case-insensitive column comparisons,
  exact large digit strings and adjacent SQL bigint values.
- A full API read with 33,000 parent groups and nested has-many, has-one,
  polymorphic and many-to-many paths, checking every relationship and all
  33,005 included child resources.

The native run combines the new suite with belongs-to batching and include-limit
conformance: **618 test-case passes**, no failures, cancellations or skips. This
includes 48 executions of the eight new cases across both storage modes and all
three databases. The SQL bigint-column case explicitly uses ordinary storage in
both mode jobs; it is not evidence of a canonical bigint column.

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 101/101 | 105/105 | 24.393s / 30.233s |
| PostgreSQL 16.15 | 101/101 | 105/105 | 28.093s / 82.073s |
| MySQL 8.0.46 | 101/101 | 105/105 | 93.981s / 107.623s |

An additional direct SQL probe verifies JavaScript BigInt input against adjacent
64-bit values on all three databases. All six runner invocations pass; this
probe likewise tests SQL transport, not canonical storage mapping.

The Node 24.6.0 full gate exits zero: **3868/3869 ordinary** (one existing skip,
91.328s), **3919/3919 canonical** (106.630s), Express 4 **355/355 ordinary**
(15.826s) and **357/357 canonical** (16.162s), type checking, query budgets,
lint and docs. All 44 statement/result counter sets per mode match the original
budget gate; timings and heap deltas are diagnostic. No runtime/test edits were
made after the native run started. All 252 frozen source entries match after
verification. Package/lock hashes, the non-root dependency graph and parked
consumer patch are unchanged. All four disposable database directories from
this batch's native runs/probes were removed by their runners.

HEAD remains `51302ce52ed9d8c72d31860de4f5c5ee69dcbfa3` on `main`; this batch is
in the existing working tree. Documentation is rebuilt after recording results.
Evidence: `/tmp/library-collection-id-lists-before-{knex,anyapi}.log`,
`/tmp/library-collection-id-lists-native-preflight.log`,
`/tmp/library-collection-id-lists-final-{gate,docs}.log`,
`/tmp/library-{id-list,mysql-id-list,id-bigint}-probe.{mjs,log}` and
`/tmp/library-sqlite-id-affinity-probe.{mjs,log}`. The frozen manifest is
`/tmp/library-collection-id-lists-final-source.json`; starting copies are in
`/tmp/library-collection-id-lists-start-pvp_9pz3`. See
[collection identifier lists and remaining work](query-measurements.md#collection-identifier-lists).

## 2026-09-10: Bounded belongs-to include queries

**78/214 complete (36.4%); 136 open.** Internal work remains 66/138, API work
10/48, migration 2/14 and final review/report 0/14. This fixes A8-F06; the wider
collection-query and memory requirements keep A8-07 open. Consumer, seed and
positioning work remains paused.

Ordinary and canonical belongs-to loaders, including polymorphic variants, now
query at most 100 target IDs per resource type in each batch. They reuse the
existing field selection, projection and policy functions with the caller's
transaction. Nested includes run after collecting every target batch, retaining
global versus per-parent collection limits. Ordinary polymorphic grouping uses
per-type sets to avoid repeatedly scanning growing arrays while retaining first
values and the existing arrays. No new normalization helper was added.

Canonical parent-link prefetches previously put each parent ID into both link
orientations in one query, and could fail before reaching the belongs-to
loader. They now deduplicate parent IDs and query at most 100 per batch,
retaining tenant/resource/relationship constraints and inverse links. Later
failures reject without returning partial rows or completing a borrowed
transaction. Policy and SQL projection callback frequency is explicit in the
[row-policy guide](../GUIDE/GUIDE_X_Row_Policies.md#query-purposes-and-lifecycle-coverage)
and [migration guide](../GUIDE/MIGRATING_API_V2.md#nested-belongs-to-include-batches).
There is no new public option or compatibility path.

The initial 17-case suite produced **15 failures and two passes per mode**:
large API reads exceeded SQLite's SQL parameter limit, and the new batching
and later-failure expectations were unmet. During implementation, test probes
were corrected to read `computeContext.context` and capture the actual
`any_links` table. Tests also caught an interim canonical-loop editing error,
which was corrected before the final source freeze. These are not counted as
additional library findings.

The final new suite contains **18 shared cases and four canonical-only cases**:

- Public nested includes with 33,000 children return every child and all 32,670
  policy-visible targets, checking every child reference and 330 bounded target
  queries for ordinary and polymorphic belongs-to relationships.
- JSON:API/plain sparse projections retain hidden dependencies and compute each
  unique included resource once despite repeated references.
- Later permission/projection failures retain typed error identity; owned full
  write responses roll back, and borrowed reads retain their transaction.
- Nested standard/window collection limits apply across the complete parent
  set; overlapping IDs remain distinct across polymorphic resource types.
- Grouping retains first-value and duplicate semantics, including zero, NaN,
  object identity, symbol keys and object-prototype property names.
- Canonical forward/inverse edges survive parent batching; 33,000 repeated
  parents need one query; empty input needs none; later SQL failure rejects
  without ending the caller's transaction.

The frozen native run combines this suite with include-limit and include-adapter
conformance. It passes **678 test cases**, with no failures, cancellations or
skips. This includes 120 executions of the new cases across the three databases.

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 105/105 | 121/121 | 21.564s / 81.399s |
| PostgreSQL 16.15 | 105/105 | 121/121 | 89.839s / 137.662s |
| MySQL 8.0.46 | 105/105 | 121/121 | 33.704s / 58.559s |

The Node 24.6.0 full gate exits zero: **3860/3861 ordinary** (one existing skip,
118.938s), **3911/3911 canonical** (146.724s), Express 4 **355/355 ordinary**
(21.709s) and **357/357 canonical** (20.483s), type checking, query budgets,
lint and docs. All 44 workload statement/result counters per mode match the
prior budget gate; timing and heap deltas are diagnostic, not equality checks.
The native runner also exits zero and removes `/tmp/jra-db-sR6BfP`.

All 250 frozen source entries match after verification. Package/lock hashes,
the non-root dependency graph and parked consumer patch are unchanged. HEAD is
`51302ce52ed9d8c72d31860de4f5c5ee69dcbfa3` on `main`; this batch remains in the
existing working tree. Documentation is rebuilt after recording these results.

The follow-up public-API probe confirms **A8-F07**: the same 33,000-child fixture
with `include: ['mentions.group.items']` still fails with SQLite's
`too many SQL variables` in both storage modes. Ordinary collection queries and
canonical reverse-linkage prefetches retain unbounded parent-ID lists. Source
inspection finds similar lists in other collection/metadata loaders. The next
correction must preserve global/per-parent ordering and limits. Complete input
and response memory also remains proportional to collection size; this batch
does not establish a total request-memory cap.

Evidence: `/tmp/library-include-batches-before-{knex,anyapi}.log`,
`/tmp/library-include-batches-preflight-{knex,anyapi}.log`,
`/tmp/library-include-batches-links-preflight.log`,
`/tmp/library-include-batches-final-{gate,native,docs}.log`, and
`/tmp/library-nested-collection-limit-probe.{mjs,log}`. The final manifest is
`/tmp/library-include-batches-final-source.json`; starting copies are
`/tmp/library-include-batches-start-mtwymjd7`. See
[include batching and remaining work](query-measurements.md#belongs-to-include-batches).

## 2026-09-10: Bounded relationship visibility reads

**78/214 complete (36.4%); 136 open.** Internal work remains 66/138, API work
10/48, migration 2/14 and final review/report 0/14. A8-F05 is fixed; broader
include-loader and memory bounds keep A8-07 open. Consumer, seed and positioning
work remains paused.

`filterVisibleIdentifiers` now iterates each resource type's deduplicated ID
set in batches of 100, using `RELATIONSHIP_READ_BATCH_SIZE`. It translates only
the current batch's values, selects distinct IDs, and applies target query
permission and filtering to every query. Predicate joins no longer multiply
the returned ID rows. Request-local visible sets remain separate by resource
type; the final filter retains input order, duplicate occurrences and original
identifier objects. A later failure rejects the call without completing the
caller's transaction. The full input/sets/result remain proportional to the
collection size; this is not a total request-memory bound.

The [row-policy contract](../GUIDE/GUIDE_X_Row_Policies.md#query-purposes-and-lifecycle-coverage)
and [migration guide](../GUIDE/MIGRATING_API_V2.md#relationship-visibility-hooks)
make the callback frequency explicit: identifier permission/filter hooks run
per target-type batch. Each query needs the complete visibility predicate;
request-level flags must not skip it on subsequent queries. These hooks retain
the ID projection and mandatory scope constraints. Ordering, pagination and
include limits belong in the existing operation/resource settings. Cloning
the supplied builder remains supported. No compatibility path or runtime option
was added.

`conformance-visibility-batches.test.js` adds ten shared cases and one canonical
tenant case. Before the change, nine of the initial ten cases fail in each mode
(one empty-input pass): 33,000 unique IDs exceed SQLite's parameter limit,
duplicate joins return excess intermediate rows, and query/batch/failure bounds
are unmet. The initial ten cases pass after the correction in 0.759s ordinary /
0.860s canonical. The final suite covers:

- 33,000 unique IDs using 330 bounded queries, including valid IDs past the first
  batch and at the end, hidden rows and repeated input occurrences.
- 33,000 repeated IDs using one query and one returned ID despite join fan-out;
  mixed resource types with overlapping IDs and changing policy contexts.
- Awaited predicates and cloned builders; target permission metadata, caller
  auth/transaction identity, and withholding parent filters/ID.
- Uncommitted changes and rollback; permission/filter rejection in the second
  batch, no partial return, and continued usability of the borrowed transaction.
- Full JSON:API/plain GETs returning all 205 included children with references
  filtered across three batches; two canonical tenant APIs reusing the same
  input IDs without sharing visibility.

The final native suite passes **63 test cases**, with no failures, cancellations
or skips. The tenant case runs only in actual canonical storage.

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 10/10 | 11/11 | 0.643s / 0.835s |
| PostgreSQL 16.15 | 10/10 | 11/11 | 1.161s / 1.679s |
| MySQL 8.0.46 | 10/10 | 11/11 | 1.291s / 2.901s |

The four-suite native run covers include limits, include permissions, related
permissions and query conformance, including global/per-parent limits, sparse
projections, hidden references, target/pivot predicates and real HTTP reads:

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 370/370 | 368/368 | 12.531s / 31.922s |
| PostgreSQL 16.15 | 370/370 | 368/368 | 69.062s / 87.225s |
| MySQL 8.0.46 | 370/370 | 368/368 | 41.124s / 39.218s |

**2214 additional passes; 2277 combined, zero failures, cancellations or skips.**
Both native runners exit zero and remove `/tmp/jra-db-GE7YMX` and
`/tmp/jra-db-McJBBx`.

The frozen Node 24.6.0 full gate exits zero: **3842/3843 ordinary** (one existing
skip, 86.231s), **3889/3889 canonical** (102.916s), Express 4 **355/355 ordinary**
(13.270s) and **357/357 canonical** (17.904s), type checking, query budgets,
lint and docs. All 44 workload statement/result counters per storage mode match
the prior gate. All 249 frozen source entries match; package/lock hashes,
the non-root dependency graph and parked consumer patch are unchanged.
Documentation is rebuilt after recording these results.

The broader audit confirms **A8-F06**, still open. With an unlimited collection
include, 33,000 reverse-polymorphic children and 33,000 referenced groups,
`groups.get({ id: '100000', queryParams: { include: ['mentions.group'] } })`
still fails with SQLite's `too many SQL variables` in both storage modes.
The direct/canonical belongs-to include loaders materialize their target IDs
into one query. The probe uses shared fixtures and adapter seeding in 200-row
chunks, asserts the original SQLite cause through the public API, and closes
both databases. Next work must address those loaders, including nested
completeness and the distinct global/per-parent ordering/limit contracts.

Evidence: `/tmp/library-visibility-batches-{before,after}-{knex,anyapi}.log`,
`/tmp/library-visibility-batches-native-preflight.log`,
`/tmp/library-visibility-batches-final-{gate,native}.log`, and
`/tmp/library-nested-include-limit-probe.{mjs,log}`. The frozen manifest is
`/tmp/library-visibility-batches-final-source.json`; starting copies are
`/tmp/library-visibility-batches-start-g8irt9iu`. See
[visibility bounds and remaining work](query-measurements.md#visibility-identifier-batches).

## 2026-09-10: Bounded ordinary pivot writes

**78/214 complete (36.4%); 136 open.** Internal work remains 66/138, API work
10/48, migration 2/14 and final review/report 0/14. This fixes A8-F04 within the
broader open A8-07 work. Consumer, seed and positioning work remains paused.

Ordinary many-to-many additions/replacements inserted all new pivot rows in a
single statement. The new regressions reproduce `SQLITE_ERROR` at 501 rows; a
direct native SQLite probe confirms `too many terms in compound SELECT` for
that INSERT shape. Both insert paths now create at most 100 row objects per
statement, using the existing `RELATIONSHIP_WRITE_BATCH_SIZE` constant.
Replacement deletes also bound their ID lists to 100. Explicit relationship
DELETE deduplicates normalized target IDs and removes them in batches of 100,
reducing 205 distinct-member removals from 205 pivot DELETEs to three.

The changes are confined to `many-to-many-manipulations.js` and
`delete-relationship.js`; no new runtime helper or API option was introduced.
Each write retains its mapped keys, owner predicate and original transaction.
Validation, target GET hooks and parent/target locking still precede writes;
unchanged membership keeps its original pivot rows. The remaining individual
canonical link writes and per-target validation were not changed.

`conformance-pivot-batches.test.js` adds ten cases. Before the correction nine
fail and one passes (6.968s); afterward all ten pass (7.236s). They cover
501-link additions/replacements, duplicate inputs, all target GET callbacks,
exact SQL batch/binding bounds, another owner's links, retained pivot rows,
undeleted targets and successful borrowed transactions. Failure cases intercept
the second pivot write at the transaction client's query boundary. They prove
that an owned transaction rolls back its first batch; a borrowed transaction
remains open with exactly the first 100 inserts or deletes pending, retains the
original error, and is restored by caller rollback. This is injected query
failure coverage, not a claim that every server-specific failure was simulated.

The suite explicitly uses ordinary tables in both storage-mode invocations;
its repeated AnyAPI-runner checks do not establish new canonical batching.
All **60 native test cases** pass: ten in each invocation on each database.

| Database | Ordinary-run / AnyAPI-run test counts | Durations |
| --- | ---: | --- |
| SQLite 3.49.2 | 10/10 and 10/10 | 7.309s / 7.509s |
| PostgreSQL 16.15 | 10/10 and 10/10 | 15.316s / 14.700s |
| MySQL 8.0.46 | 10/10 and 10/10 | 79.612s / 109.305s |

The additional five-suite native run covers relationship lock/edge batches,
concurrent transactions, relationship writes, IDs and bulk failures:

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 169/169 | 174/174 | 7.781s / 11.946s |
| PostgreSQL 16.15 | 170/170 | 175/175 | 38.375s / 62.306s |
| MySQL 8.0.46 | 170/170 | 175/175 | 51.457s / 62.970s |

**1033 additional passes; 1093 combined, zero failures, cancellations or skips.**
Both native runners exit zero and remove `/tmp/jra-db-R3ozRy` and
`/tmp/jra-db-9ghSYf`. Durations are observations from concurrent verification
jobs, not throughput measurements.

The Node 24.6.0 full gate exits zero: **3832/3833 ordinary** (one existing skip,
98.887s), **3878/3878 canonical** (110.839s), Express 4 **355/355 ordinary**
(15.374s) and **357/357 canonical** (12.361s), type checking, query budgets,
lint and docs. All 44 workload statement/result counters in each storage mode
match the preceding gate. All 248 frozen source entries match after verification;
package/lock hashes, the non-root dependency graph and parked consumer patch are
unchanged. Documentation is rebuilt after recording these results.

The continued read-path review also reproduces **A8-F05**, still open:
`filterVisibleIdentifiers` receives 33,000 distinct `{ type: 'groups', id }`
identifiers against the existing ID fixture and builds one oversized `WHERE IN`.
Both storage modes reject with SQLite's `too many SQL variables`. The probe
uses `createConformanceFixture`/`createIdConformanceApi` and closes each database;
it establishes the shared helper failure, not a completed full-API large-include
regression. Next work must bound these reads while retaining complete results,
authorization and customization behavior, duplicate handling, global include
ordering/limits and per-parent limits. Broader memory bounds remain open too.

Evidence: `/tmp/library-pivot-batches-{before,after}.log`,
`/tmp/library-pivot-batches-native-preflight.log`,
`/tmp/library-pivot-batches-final-{gate,native}.log`, and
`/tmp/library-include-binding-limit-probe.log`. The frozen source manifest is
`/tmp/library-pivot-batches-final-source.json`; starting copies are
`/tmp/library-pivot-batches-start-0q1vq2iw`. See
[pivot behavior and remaining work](query-measurements.md#ordinary-pivot-write-batches).

## 2026-09-10: Enforced query-count budgets

**A8-03 is complete: 78/214 (36.4%); 136 open.** Internal work is 66/138,
API work 10/48, migration 2/14 and final review/report 0/14. Consumer, seed and
positioning work remains paused. No production runtime or `tests/*.test.js`
file changed in this batch; the changes are verification scripts, commands and
documentation.

The existing workload script now enforces SQL ceilings by operation shape,
polymorphic target-type count, requested-record count, transaction mode and
100-ID write-query batch size. Two new measurements use 101 visible targets
to cross the batch boundary, giving 44 total per database/storage combination.
Result, ordering, visibility, membership, write/deletion and zero-metadata-SQL
checks remain. Lower query counts may pass with those behavior checks; timing
and heap measurements remain informational. The ceiling definitions do not
import runtime constants or derive allowances from the implementation being
measured. [The budget guide](query-measurements.md#enforced-query-budgets)
documents the equations and fixture limits.

`npm run test:query-budgets` runs both SQLite storage jobs. `npm run verify`
places them after type checking and before the full suites. The SQL database
runner includes the script in its default file list; explicit file selection
and Redis jobs retain their existing behavior. The current CI workflow already
uses those commands, so it gains budget enforcement without another job or a
workflow edit. This is local command/source verification, not a claimed remote
GitHub run.

The initial budget command passes 44/44 measurements in each storage mode.
Temporarily adding `await knex.raw('select 1')` inside the measured operation
causes `npm run verify` to reject the first workload: **5 SQL statements exceed
budget 4**. Neither the canonical budget stage nor the full tests then runs.
The injected statement is removed and the script matches its saved good copy
byte for byte before the successful final runs.

The Node 24.6.0 full gate exits zero: type checking, both 44-measurement budget
jobs, **3822/3823 ordinary** (one existing skip, 74.853s), **3868/3868 canonical**
(87.237s), Express 4 **355/355 ordinary** (10.483s) and **357/357 canonical**
(11.209s), lint and documentation build. No tests fail or are cancelled.

The native runner selects `scripts/measure-query-baseline.js` explicitly:

| Database | Ordinary / canonical measurements | Script durations |
| --- | ---: | --- |
| SQLite 3.49.2 | 44/44 and 44/44 | 4.109s / 5.059s |
| PostgreSQL 16.15 | 44/44 and 44/44 | 27.314s / 36.670s |
| MySQL 8.0.46 | 44/44 and 44/44 | 35.999s / 43.826s |

**264 measurements pass, with identical statement/result counters across all
three databases and the independent SQLite run.** This is six successful Node
script-file test executions, not 264 additional Node test cases. The native
runner exits zero and removes `/tmp/jra-db-tX0d1q`. This batch does not repeat the
unchanged full native conformance matrix from the preceding runtime change.

All 247 frozen source entries match after verification. Relative to the preceding
runtime gate, only the two verification scripts, `package.json` commands and
`tests/README.md` differ within that manifest. The lockfile, non-root dependency
graph and parked consumer patch remain unchanged; no dependencies or non-script
package fields changed. Documentation is rebuilt after recording completion.

Evidence: `/tmp/library-query-budgets-first.log`,
`/tmp/library-query-budgets-injected-gate.log`,
`/tmp/library-query-budgets-final-{gate,native}.log`, and extracted
`/tmp/library-query-budgets-{better-sqlite3,pg,mysql2}-{knex,anyapi}.json`.
The source manifest is `/tmp/library-query-budgets-final-source.json`; starting
copies are `/tmp/library-query-budgets-start-lsi6btw0`. The new command-only
`package.json` SHA-256 is
`93b6c7efc70754e7007345d4319df09afb6e30b46b471f18d34164c72694e14d`.
Broader relationship/include batching, parameter/memory bounds, query plans
and consumer regression work remain open under the other A8 items.

## 2026-09-10: Relationship write batches and bulk configuration

**77/214 complete (36.0%); 137 open.** This advances A8-04/A8-06/A8-07 without
closing their broader validation/include/bulk requirements. Consumer, seed and
positioning work remains paused. A8-F01 is partially addressed; A8-F02 and
A8-F03 are fixed.

The shared relationship target-lock helper deduplicates IDs within resources
and bounds queries to 100 requested IDs. It uses published storage adapters,
retains resource/tenant scope and the caller's transaction, and preserves the
first missing input ID. Database comparisons handle alternate spellings under
column collations. Canonical link attachment batches existing edge lookups,
retaining the full tenant/relationship/resource/owner identity and canonical
orientation. New/unmatched edge cases still use database existence comparisons
when collation equality could match an existing or newly inserted row. Inserts
remain individual operations. No global data cache or compatibility layer was
introduced, and per-target GET validation/hooks still execute.

On the measured idempotent-add fixture, size 10 drops **60 → 51 ordinary /
79 → 61 canonical statements**; size 40 drops **225 → 186 / 304 → 226**. The
size-1 operation and other 39 workload shapes/scales retain their counts. All
252 after-change measurements complete across the three databases and both
storage modes. Statement/result counters match the independent SQLite runs and
match across databases; metadata SQL stays zero. See [the results and limits](query-measurements.md#relationship-write-batches).

The batch suite has five shared cases plus five canonical cases. It verifies
three lock queries for 205 distinct IDs, one for 205 repeated IDs, three existing
edge lookups for 205 canonical members, per-query binding limits, resource
separation, missing targets across batches, and the caller's open transaction.
PostgreSQL/MySQL NOWAIT probes prove the final target remains locked; SQLite
retains its existing transaction/snapshot conflict behavior. The ordinary
case-insensitive ID-column case runs in both mode invocations; it is not a
canonical-collation migration. Public cases retain every target GET hook,
mixed/duplicate inputs, another owner's links, inverse metadata repair and
payloads, and roll back all link batches on owned finish failure/caller rollback.
The initial lock-budget checks failed with 205 queries before batching. A first
collation fixture changed only a reference column; that setup was corrected to
change the ID column before relying on its test.

The disconnected bulk optimization handler and ineffective `batchSize` /
`enableOptimizations` settings are removed. The POST loop now directly iterates
records through their normal write lifecycle. A zero/invalid batch increment
can no longer hang/skip work. Installation accepts only positive safe-integer
`maxBulkOperations` and boolean `defaultAtomic`, supplied directly; unknown keys
and nested wrappers reject. The 22-case configuration/lifecycle suite verifies
17 invalid installations plus limits for all methods, hooks/validation/failure
indexes, default non-atomic behavior and atomic override. All 17 installation
checks failed before validation was added; five valid-behavior cases already
passed. The existing basic bulk fixture now actually forwards its options.
The [easy migration guide](../GUIDE/MIGRATING_API_V2.md#bulk-writes) and bulk
reference document the removed settings and actual sequential behavior.
This cleanup is not a completed bulk SQL optimization.

The frozen Node 24.6.0 full gate exits zero: **3822/3823 ordinary** (one existing
skip, 75.460s), **3868/3868 canonical** (94.728s), Express 4 **355/355 ordinary**
(15.482s) and **357/357 canonical** (17.208s), plus type checking, lint and docs.

The two new suites' native run passes **177 checks**: 27 ordinary / 32 canonical
on each database (SQLite 1.411s / 4.611s, PostgreSQL 2.655s / 10.551s,
MySQL 4.170s / 15.453s). The additional native run covers concurrency, bulk
authorization/failure cleanup, relationship writes, descriptor transactions,
ID/query conformance and the workload script:

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 365/365 | 363/363 | 32.021s / 42.514s |
| PostgreSQL 16.15 | 366/366 | 364/364 | 85.622s / 54.617s |
| MySQL 8.0.46 | 366/366 | 364/364 | 33.243s / 43.555s |

**2188 additional passes; 2365 combined, zero failures, cancellations or skips.**
The additional run includes six workload-script executions, each checking 42
measurements; these are not 252 extra Node test cases. Both native runners exit
zero, and `/tmp/jra-db-3b1Fh9` / `/tmp/jra-db-f36DT3` are removed. All 247 frozen
source entries match after verification. Package/lock hashes, the non-root
dependency graph and the parked consumer patch are unchanged. Documentation is
rebuilt after recording these results.

Evidence: `/tmp/library-relationship-batching-before-{knex,anyapi}.log`,
`/tmp/library-bulk-configuration-before.log`,
`/tmp/library-relationship-batching-native-preflight.log`,
`/tmp/library-relationship-batching-final-{gate,native}.log`,
`/tmp/library-relationship-batching-measure-{knex,anyapi}.log` and extracted
`/tmp/library-relationship-batching-{better-sqlite3,pg,mysql2}-{knex,anyapi}.json`.
The manifest is `/tmp/library-relationship-batching-final-source.json` and the
starting copies are `/tmp/library-relationship-batching-start-l12ctynh`.

## 2026-09-10: Workload baselines and related endpoint review

**A8-02 and A8-05 are complete: 77/214 (36.0%); 137 open.** Internal work is
65/138, API work 10/48, migration 2/14 and final review/report 0/14. Consumer,
seed and positioning work remains paused.

The existing measurement script now uses the shared disposable database helper
and verifies 42 measurements per database/storage combination. It retains the
six original book workloads and adds hasMany/many-to-many reads, one/two-type
polymorphic includes, allowed/denied relationship additions and atomic/non-atomic
bulk POST/PATCH/DELETE at sizes 1, 10 and 40. The shared fixture seeds equal
numbers of visible, policy-hidden and other-workspace tasks. Checks cover
identity, ordering, visible totals, included records, write results and deletion.
Counter output contains no SQL, bindings, records or connection settings. Setup
and verification reads remain outside measurement; transaction/hook work inside
the operation is counted. All measured configuration-table counts remain zero.

All **252 measurements** complete across SQLite 3.49.2, PostgreSQL 16.15 and
MySQL 8.0.46, both storage modes, on Node 24.6.0. Their statement/result counters
match across databases; two SQLite executions also match. Related read counts
stay constant from 10 to 40 results when the two polymorphic target types remain
fixed. The full [baseline table](query-measurements.md#workload-baselines) records
write growth: idempotently adding 40 existing visible members uses **225 ordinary
/ 304 canonical statements**. This includes validation, target locks and edge
checks, not 40 new inserts. A8-F01 identifies these repeated reads for subsequent
batching. A8-F02 records the disconnected bulk optimization hook and its
nonexistent method calls; activating it would bypass the normal write lifecycle.
These findings remain open under A8-04/A8-06.

The related endpoint already uses a parent constraint or membership subquery
through the normal target collection query. The historical per-ID fallback is
absent, so no replacement implementation was needed. Existing tests cover
filters, permissions, counts, links, includes, duplicate/inverse memberships,
borrowed transactions and the to-one target GET hook contract. Two additional
cases compare 2/10/40-result pages in both formats, both collection relationship
kinds, with/without polymorphic includes. They check constant SQL counts,
zero configuration reads, exact visible IDs/counts, selected fields and targets.
The broader A8-03/A8-07 batch-size budgets remain open.

The frozen full gate exits zero: **3795/3796 ordinary** (one existing skip,
92.512s), **3836/3836 canonical** (113.258s), Express 4 **355/355 ordinary**
(19.445s) and **357/357 canonical** (19.497s), plus type checking, lint and docs.
The native run selects query conformance, related collections, related
permissions, authorization and the measurement script:

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 292/292 | 290/290 | 27.727s / 36.597s |
| PostgreSQL 16.15 | 292/292 | 290/290 | 77.354s / 85.289s |
| MySQL 8.0.46 | 292/292 | 290/290 | 41.708s / 36.773s |

**1746 passed, zero failures, cancellations or skips.** This test count includes
six successful script-file executions, each checking 42 measurements; the 252
measurements are not 252 extra Node test cases. The native runner exits zero and
its `/tmp/jra-db-boatQg` directory is removed. All 245 frozen source entries match.
Only the measurement script, shared fixture and query tests changed since the
previous runtime verification. Package/lock hashes, the non-root dependency
graph and the parked consumer patch are unchanged. Documentation is rebuilt
after recording these results.

Evidence: `/tmp/library-workload-baseline-second-{knex,anyapi}.log`,
`/tmp/library-workload-scaling-first-{knex,anyapi}.log`,
`/tmp/library-workload-baselines-final-gate.log`,
`/tmp/library-workload-baselines-final-native.log` and extracted
`/tmp/library-workload-baseline-{better-sqlite3,pg,mysql2}-{knex,anyapi}.json`.
The frozen source manifest is `/tmp/library-workload-baselines-final-source.json`;
the starting copies are `/tmp/library-workload-baselines-start-m0sacdc4`.

## 2026-09-10: Published descriptors and query measurements

**A8-01 is complete: 75/214 (35.0%); 139 open.** The work also resolves A5-F15
within the broader open A5 metadata/configuration items. Consumer, seed and
positioning work remains paused.

Canonical adapters already captured the descriptor published with
`schemaInfo`, while other request paths reloaded registry configuration. The
correction makes those paths use the published descriptor too. Related query
maps are built synchronously from registered resources; the unused query-adapter
registry member and repeated ID fallback selection are removed. There is no
additional cache, invalidation framework or compatibility layer.

Direct registry reads keep their existing transaction and error semantics.
Resource configuration becomes effective through registration, supported field
addition or explicit descriptor refresh. Direct registry/raw configuration
changes do not implicitly update resource operations. Tests with distinct old
and new slots verify coherent reads/writes before and after refresh. Failed
refreshes retain the previous publication. Borrowed registry additions and
overlapping tenant APIs remain isolated. Arbitrary concurrent/in-place
reconfiguration is not established by this correction; see the
[migration steps](../GUIDE/MIGRATING_API_V2.md#schema-migration-helpers).

The transaction suite now has **47 cases** and asserts zero configuration-table
queries during cold CRUD, relationships, nested reads, counts and rollback.
The first selected baseline cases failed that new assertion before the change.
The old descriptor-failure suite simulated request-time database loads that no
longer occur. Its replacement has **20 cases** covering explicit registry and
publication failures, absent required published metadata, retained prior
publication, and real HTTP operation while registry reads fail. Existing
data/relationship callback and transaction-failure suites still run in full.
Eight reverse-metadata fault tests now corrupt the published descriptor used by
the operation; their rejection assertions remain. This explains the reduced
full-suite test count rather than treating it as lost database-read coverage.

The existing `scripts/measure-query-baseline.js` now measures six read/write
shapes and reports metadata statement counts alongside total statements, result
counts, elapsed time and heap delta. It prints counters rather than SQL,
bindings or row contents. Two independent post-change runs match all
statement/metadata/result counts in each storage mode. Canonical full PATCH
drops **32 → 11 statements** (21 → 0 metadata), and nested PATCH
**59 → 17** (42 → 0 metadata), with unchanged records/includes. Ordinary
counts remain unchanged. The [measurement guide](query-measurements.md) gives
the commands, complete table, counter semantics and timing/memory limitations.
Broader A8 workload/batching/plan work remains open.

The seven-file preflight passes **224 ordinary / 243 canonical**; the final
required-metadata fault case was then added and its 20-case file passed. The
frozen Node 24.6.0 full gate exits zero: **3793/3794 ordinary** (one existing
skip, 93.377s), **3834/3834 canonical** (112.271s), Express 4 **355/355 ordinary**
(17.779s) and **357/357 canonical** (21.220s), plus type checking, lint and docs.

The eight-file native matrix covers descriptor transactions/publication,
field evolution, registry failures, relationship metadata, schema enrichment,
concurrency and declaration namespaces:

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 283/283 | 309/309 | 19.114s / 29.489s |
| PostgreSQL 16.15 | 284/284 | 310/310 | 63.977s / 98.342s |
| MySQL 8.0.46 | 284/284 | 310/310 | 51.892s / 62.794s |

**1780 passed, zero failures, cancellations or skips.** The runner exits zero
and `/tmp/jra-db-DiOIAl` has been removed. All 245 frozen source entries match
after both gates; package/lock hashes, the non-root dependency graph and the
parked consumer patch are unchanged. The guide now links its common migration
steps before the specialized reference sections. Documentation is rebuilt after
recording these results.

Evidence: `/tmp/library-published-descriptor-before-tests.log`,
`/tmp/library-published-descriptor-{before,after,repeat}-{knex,anyapi}.log`,
`/tmp/library-published-descriptor-preflight-{knex,anyapi}.log`,
`/tmp/library-published-descriptor-fault-complete.log`,
`/tmp/library-published-descriptor-final-gate.log` and
`/tmp/library-published-descriptor-final-native.log`. The source manifest is
`/tmp/library-published-descriptor-final-source.json`.

## 2026-09-10: Cold descriptor transactions and shared include parsing

**74/214 complete (34.6%); 140 open.** This corrects A5-F14 and another bounded
part of A5-F12. No whole checklist item is completed. A5-F15 records the measured
metadata-query cost that remains to be addressed. Consumer, seed and positioning
work remains paused.

The canonical plugin now forwards the active transaction to its existing
descriptor helper, inverse many-to-many resolution, include/linkage loaders and
related-descriptor preloading for queries/counts. Configuration refresh outside
an operation keeps the normal registry lookup. The registry's transaction and
cache policies are unchanged: transactional reads bypass the committed cache,
and an operation never completes a transaction borrowed from its caller.

`tests/anyapi-descriptor-transactions.test.js` uses a real single-connection pool
on every database. Its **46 cases** cover cold CRUD, PUT-create, full/no return,
relationship writes, nested reads, finish failure, rollback and ownership, with
both response formats where their conversion paths differ. It also checks that
transactional descriptors do not populate the committed cache. The initial
42-case draft passed zero cases: 36 exposed the connection timeout, while six
plain writes supplied `type` instead of the existing polymorphic `_type`
convention. Correcting those inputs retained the current runtime contract.
The pre-change public probe independently reproduced the timeout after 109 ms.

The existing concurrency suite now invalidates canonical descriptors after
seeding, so independent writer/observer transactions exercise cold metadata.
The descriptor-failure suite's injector now intercepts the actual transaction
as well as the global database; its typed/unexpected error, ownership and data
preservation assertions remain. A separate single-connection count probe checks
that the standalone count helper sees a borrowed transaction's uncommitted
insert, leaves ownership active and preserves the original row after rollback.

The follow-up include audit found a second parser in the canonical plugin.
`constructor.constructor` returned the correct included records but added an
own `constructor` property to JavaScript's built-in `Object` function. Nested
`toString.toString` similarly mutated an inherited function. The expanded
canonical namespace suite reproduced both failures (**63/65** before the fix).
The duplicate parser is removed; both plugins now use the existing shared
helper. Three public regressions check nested results and unchanged function
properties, with cleanup even when the assertion fails. No new runtime helper,
cache or compatibility layer was added.

The six-file preflight passes **266 ordinary / 273 canonical**. The frozen
Node 24.6.0 full gate exits zero: **3832/3833 ordinary** (one existing skip,
82.366s), **3873/3873 canonical** (145.897s), Express 4 **364/364 ordinary**
(18.797s) and **366/366 canonical** (27.326s), plus type checking, lint and docs.

The six-file native matrix covers cold descriptor transactions, descriptor
failures, concurrent transactions, reused transaction context, registry failures
and declaration namespaces:

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 266/266 | 273/273 | 60.075s / 65.686s |
| PostgreSQL 16.15 | 267/267 | 274/274 | 149.831s / 70.178s |
| MySQL 8.0.46 | 267/267 | 274/274 | 45.626s / 75.978s |

**1621 passed, zero failures, cancellations or skips.** The runner exits zero
and `/tmp/jra-db-IcIekg` has been removed. All 245 source-manifest entries remain
unchanged after both gates. Package/lock hashes, the non-root dependency graph
and the parked consumer patch are unchanged. Documentation is rebuilt after
recording these results.

The query-cost probe reproduces the previous warm-cache path with a wrapper
that omits the newly forwarded transaction, then measures the corrected path
on the same fixture. A full PATCH without explicit includes goes from
**9 to 30 statements** (0 to 21 metadata queries); with `group.items`, from
**15 to 57** (0 to 42 metadata queries). These counts justify the next compiled
metadata/configuration work. They do not justify sharing uncommitted descriptors
between transactions, and no latency/throughput claim is made from this probe.
See [A5-F15 and its acceptance criteria](compiled-resources.md).

Evidence: `/tmp/library-descriptor-transactions-before.log`,
`/tmp/library-descriptor-transactions-preflight-{knex,anyapi}.log`,
`/tmp/library-canonical-nested-include-probe.log`,
`/tmp/library-canonical-nested-include-before.log`,
`/tmp/library-descriptor-cold-count-probe.log`,
`/tmp/library-descriptor-transactions-query-cost.log`,
`/tmp/library-descriptor-transactions-final-gate.log` and
`/tmp/library-descriptor-transactions-final-native.log`. The frozen 245-file
manifest is `/tmp/library-descriptor-transactions-final-source.json`.

## 2026-09-10: Declaration namespaces and relationship dictionaries

**74/214 complete (34.6%); 140 open.** This completes another bounded correction
within A5-F12, not a whole checklist item. Wider namespace/capability conflicts
and the other compiled metadata work remain open. Consumer, seed and positioning
work remains paused.

Declaration maps now reject `__proto__` keys and inherited declarations before
copying. Plain and null-prototype maps containing own declarations remain valid.
The same checks cover mutable schema/search/computed enrichment output,
projection declarations, field additions, direct storage/migration helpers,
canonical registration/allocation and persisted descriptor field names/aliases.
Nested JSON values retain their keys; this is not a recursive data restriction
or a complete JSON:API member-name grammar validator. The
[migration guide](../GUIDE/MIGRATING_API_V2.md#declaration-dictionaries-and-reserved-names)
explains declaration names, resource names and existing mappings separately.

Further public regressions reproduced inherited-property failures in include
trees, polymorphic resource grouping, canonical relationship classification and
resource fieldset lookup. Those paths now require or create own entries. A
single lookup in the existing field utilities serves selection, enrichment and
response filtering. Direct foreign-key attributes named `constructor` now
reject consistently instead of being silently removed. No new runtime module,
compatibility layer or automatic data migration was introduced.

The initial namespace regression file passed **2/23 in each storage mode**:
nested JSON already worked; the declaration guards were missing. The final file
passes **55 ordinary / 62 canonical**, including supported prototype-named
resources/aliases, nested JSON round trips and null-prototype declaration maps.
A draft plain-format assertion incorrectly expected a null relationship
property; the established plain contract omits it, while JSON:API returns
`data: null`. The assertion was corrected without changing that runtime contract.

The first full gate found one diagnostic mismatch: invalid projection arrays
were rejected correctly, but the new message omitted the existing expected
phrase `Expected an object`. Restoring that explanation was the only runtime
change before the final rerun. Both frozen Node 24.6.0 gates have now finished.
The full suites pass **3783/3784 ordinary** (one existing skip, 85.060s) and
**3824/3824 canonical** (101.628s). Express 4 passes **364/364 ordinary**
(14.964s) and **366/366 canonical** (18.571s). Type checking, lint and the
documentation build pass.

The seven-file native matrix covers declaration namespaces, field names,
schema enrichment, relationship metadata, IDs, field evolution and registry
failures:

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 335/335 | 361/361 | 11.588s / 23.915s |
| PostgreSQL 16.15 | 335/335 | 361/361 | 50.570s / 89.342s |
| MySQL 8.0.46 | 335/335 | 361/361 | 31.932s / 67.504s |

**2088 passed, zero failures, cancellations or skips.** Both database run
directories (`/tmp/jra-db-vTvqwT` and `/tmp/jra-db-hEWrAZ`) have been removed.
All 244 frozen source files match after the gates; package/lock hashes, the
non-root dependency graph and the parked consumer patch remain unchanged.

The tampered-metadata regressions also exposed **A5-F14**, a separate cold-cache
transaction defect. With SQLite's only connection held by POST, descriptor
loading attempts to borrow another connection through the global pool. An
independent public probe fails after 109 ms with zero stored rows; warming the
descriptor makes the next write succeed. Restoring the pre-test cache alongside
tampered metadata is fixture cleanup, not a fix for that defect. The
[inventory and acceptance criteria](compiled-resources.md)
keep cold-cache transaction handling open as the next correction.

Evidence: `/tmp/library-field-namespace-before-{knex,anyapi}.log`,
`/tmp/library-field-namespace-all-{knex,anyapi}.log`,
`/tmp/library-field-namespace-final-gate.log`,
`/tmp/library-field-namespace-final-gate-rerun.log`,
`/tmp/library-field-namespace-final-native-rerun.log` and
`/tmp/library-cold-descriptor-write-probe.log`. The source manifest is
`/tmp/library-field-namespace-rerun-source.json`.

## 2026-09-10: Prototype-named fields and single column translation

**74/214 complete (34.6%); 140 open.** This fixes a bounded part of A5-F12 and
the newly reproduced A5-F13; no whole checklist item is completed. The
[metadata inventory](compiled-resources.md) distinguishes corrected own-property
lookups and minimal reads from the remaining `__proto__` declaration and
relationship/resource dictionary audit. Consumer, seed and positioning work
remains paused.

The initial public regression file had 33 cases per mode. Ordinary storage
passed 0/33 and canonical storage 14/33. One negative test expected a generic
validation error instead of the existing fieldset error; that assertion was
corrected. The other failures demonstrated dropped writes and generated
filters, inherited values passed to getters, and a canonical virtual input
incorrectly written to a column named `undefined`. These baseline totals are
not a count of distinct runtime defects.

The first corrections exposed two additional boundaries:

- Knex's update compiler drops physical keys `constructor`, `prototype` and
  `__proto__`, including its single-column overload and null-prototype inputs.
  Ordinary registration, adapters and table/migration helpers now reject these
  physical mappings. Public names remain available through `storage.column`;
  canonical slots need no such override. The
  [migration guide](../GUIDE/MIGRATING_API_V2.md#public-field-names-and-physical-columns)
  covers existing columns without automatically changing stored data.
- Minimal reads translated physical mappings twice. They now pass the raw row
  to the JSON:API converter, preserving overlapping logical and physical names
  for write authorization and PUT completeness checks.

The final field-name file has **89 cases per mode**, covering eight public
names, both naming modes and response formats, writes, sparse reads, generated
filters, cursor traversal, getter/setter presence, dependency inputs, hidden
sorting, unsupported columns/IDs and overlapping mappings. An expanded draft
exceeded canonical string-slot capacity; its unused fixture field is now virtual.
No runtime capacity or existing test assertion was weakened. The five-file
preflight passes **195 ordinary / 198 canonical**.

The frozen Node 24.6.0 native matrix ran field names, field dependencies, hidden
sorts, storage boundaries and advanced table operations:

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 195/195 | 198/198 | 3.531s / 6.325s |
| PostgreSQL 16.15 | 195/195 | 198/198 | 19.669s / 31.588s |
| MySQL 8.0.46 | 195/195 | 198/198 | 11.876s / 63.389s |

**1179 passed, zero failures, cancellations or skips.** The runner exited zero
and `/tmp/jra-db-Ctck2P` was removed. The ordinary full suite passes
**3728/3729**, with one existing skip (88.794s); canonical passes
**3762/3762** (98.801s). Express 4 passes **364/364 ordinary** (10.569s) and
**366/366 canonical** (11.911s). Type checking, lint and docs pass; the complete
`npm run verify` process exited zero. All 243 frozen source files still match
after both gates closed. Documentation was rebuilt after recording these results.

Evidence: `/tmp/library-field-names-before-{knex,anyapi}.log`,
`/tmp/library-field-names-knex-dependency.log`,
`/tmp/library-field-names-preflight-{knex,anyapi}.log`,
`/tmp/library-field-names-final-gate.log` and
`/tmp/library-field-names-final-native.log`. The 243-file source manifest is
`/tmp/library-field-names-final-source.json`. The prior package/lock hashes,
non-root dependency graph and parked consumer patch remain unchanged.

## 2026-09-10: Incremental storage type checking

**A9-01 and A9-10 are complete: 74/214 (34.6%), 140 open.** The
[scope document](typechecking.md) identifies the four checked implementation
modules and the remaining dynamically typed code. A6-02 and A9-02–09 remain open
for broader contracts, lifecycle/context typing, diagnostics and public consumer
declarations. Consumer, seed and positioning implementation remain paused.

The first strict pass produced **163 diagnostics** in the adapter, ordinary and
canonical mapping helpers and hook adapter utilities
(`/tmp/library-types-before.log`). Most were absent annotations or imprecise
inference; this is not a claim of 163 runtime bugs. Checked JSDoc now describes
the existing boundaries, with `unknown` values and absent dictionary entries
explicit. `storage-types.d.ts` is an internal declaration, not a second runtime
metadata system. No emitted JavaScript or runtime compilation step was added.

TypeScript 5.9.3 and `@types/node` 24.0.14 were already locked transitively and
are now direct exact development dependencies. The final lockfile changes only
the root development declarations and TypeScript's former peer marker; no
package versions or package entries changed. The existing CI job invokes
`npm run verify`, which now runs the type check first. Remote CI was not run.

The checked contract fixture has positive calls and **12 negative cases** for
adapter methods, arguments, row/selection shapes, database handles, ownership
and unknown output values. A compiler-host probe removed the expectation
directives in memory: all **12 intended errors** appeared in that fixture, with
no implementation diagnostics (`/tmp/library-types-negative-proof.log`). It did
not edit the runtime or test source. The normal check and lint pass.

Runtime regressions accompanying the types resolve two findings:

- **A5-F10:** the direct naming normalizer accepted inherited alias-table
  properties. The initial public registration tests passed three cases because
  later revalidation rejected them, but failed to reject a coercible object
  (`/tmp/library-storage-naming-before-{knex,anyapi}.log`). The boundary now
  accepts only own string keys. Nine final cases cover direct/registration
  rejection and every supported spelling.
- **A5-F11:** a missing reverse mapping in a partial canonical descriptor
  deleted an unrelated attribute literally named `undefined`. The regression
  failed with missing output before the guard
  (`/tmp/library-reverse-mapping-before.log`), then passed with linkage intact.

Review of a draft thenable narrowing check found that a Proxy can expose
`then` without reporting the property through `has`. That draft failed the
new proxy regression (`/tmp/library-types-thenable-guard-probe.log`). The final
code retains the original direct property probe with an optional unknown
property type, preserving synchronous-serializer enforcement. Resolved/rejected
promises, callable thenables and proxy thenables all reject before writes and
filters; rejected results remain owned. Other small changes narrow the existing
canonical map variants, capture the selected descriptor once and make the
already-matched select alias pair explicit.

The two-file focused SQLite selection passes **51 ordinary / 54 canonical**
(`/tmp/library-types-focused-{knex,anyapi}.log`). Final frozen Node 24.6.0
`npm run verify` exits **0** (`/tmp/library-types-final-gate.log`):

| Gate | Passed | Skipped | Duration |
| --- | ---: | ---: | ---: |
| TypeScript check | Passed, including 12 negative contracts | — | — |
| Ordinary full suite | 3639/3640 | 1 existing skip | 90.293 s |
| Canonical full suite | 3673/3673 | 0 | 107.678 s |
| Express 4 ordinary | 364/364 | 0 | 16.172 s |
| Express 4 canonical | 366/366 | 0 | 16.494 s |
| ESLint | Passed | — | — |
| Documentation build | Passed | — | 3.441 s |

The five-file native selection covers storage boundaries, serializers, include
adapters, logical sorting and transitive dependencies. It exits **0** with
**996 passed**, no failures, cancellations or skips
(`/tmp/library-types-final-native.log`):

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 158/158 | 174/174 | 4.576 / 15.204 s |
| PostgreSQL 16.15 | 158/158 | 174/174 | 28.582 / 45.939 s |
| MySQL 8.0.46 | 158/158 | 174/174 | 24.917 / 82.077 s |

These counts include direct mapping and compilation checks as well as SQL
execution. The native environment was removed. All **242 files** in
`/tmp/library-types-final-source.sha256` still match after both gates. The
archived consumer patch is unchanged; the migration guide documents the naming
validation and partial-descriptor output correction.

A subsequent read-only review identified **open A5-F12**: prototype-named fields
still differ by backend. Ordinary POST/GET returns null for declared
`constructor` and `toString` string attributes, while canonical storage retains
their values. Direct `__proto__` mapping also loses keys; public writes reject
schema validation. The two probe logs and regression acceptance are recorded in
the [metadata inventory](compiled-resources.md). This remains required work,
not evidence that runtime metadata correctness or final whole-library review
has been completed.

## 2026-09-10: Hidden sort visibility

**72/214 complete (33.6%), 142 open.** This is a bounded correction under
A5-03/A5-10; it does not finish their broader metadata/configuration or consumer
acceptance requirements. Consumer and positioning work remain paused.

The initial 24-case regression suite passed **8** and failed **16** in each
storage mode (`/tmp/library-hidden-sorts-before-{knex,anyapi}.log`). Hidden stored
fields and their aliases could enter explicit sorting and produce incomplete
cursors. Hidden projections could disclose their selected SQL values in cursor
metadata and generated links. Contradictory local declarations and include
ordering were accepted. The original read-only probe is
`/tmp/library-hidden-sort-probe.log`.

The existing `getEffectiveSortableFields` excludes hidden resolved definitions,
including explicit allowlists and sortable projection flags. The existing
`buildEffectiveSortList` rejects hidden sort keys with typed `hidden_sort`
violations. Schema compilation uses that same check for explicit/default sorts
and sortable projections; storage query execution rechecks after hooks, and
the shared include ordering checks forward-declared targets when resolved.
Alias validation reads the resolved stored/projection definition. No metadata
copy, new utility module, compatibility flag or dependency was added.

The corrected first 24 cases pass in both modes. Four additional cases cover
aliases targeting hidden projections, for **28/28 per mode**
(`/tmp/library-hidden-sorts-expanded-{knex,anyapi}.log`). The suite verifies
compilation rejection, late allowlist/flag changes, post-validation query-hook
overrides before SQL, standard/window include ordering, hidden computed inputs
and normally-hidden stored/alias/projection cursors. Positive cases traverse
generated sparse links in both JSON:API and plain output and check that hidden
dependency values remain absent from responses.

The initial full Node 24 gate stopped after the ordinary suite: **3624 passed,
0 failed, 4 cancelled, 1 existing skip**
(`/tmp/library-hidden-sorts-final-gate.log`). Two label fixtures replaced their
schema with a hidden `name` while inheriting the factory's sortable `name`.
Compilation correctly rejected these contradictory configurations before their
four tests could run. The label scenarios now explicitly use
`sortableFields: ['id']`; all hidden-label assertions are retained.

The five-file native selection covers hidden sorts, logical sort fields,
transitive field dependencies, reference sorting and include limits. It exits
**0** with **1527 passed**, no failures, skips or cancellations
(`/tmp/library-hidden-sorts-final-native.log`):

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 254/254 | 255/255 | 29.593 / 38.308 s |
| PostgreSQL 16.15 | 254/254 | 255/255 | 54.504 / 47.674 s |
| MySQL 8.0.46 | 254/254 | 255/255 | 28.810 / 66.818 s |

These counts include compilation/non-SQL cases; the existing reference/include
suites also exercise real HTTP. The disposable database directory was removed.
The initial 239-file source manifest matched when the native matrix finished.
Only the label test fixture changed afterward; every runtime file and every
test in the native selection remains identical. The initial/final manifests
are `/tmp/library-hidden-sorts-{initial,final}-source.sha256`.

The final Node 24.6.0 `npm run verify` exits **0**
(`/tmp/library-hidden-sorts-final-gate-rerun.log`):

| Gate | Passed | Skipped | Duration |
| --- | ---: | ---: | ---: |
| Ordinary full suite | 3628/3629 | 1 existing skip | 75.972 s |
| Canonical full suite | 3661/3661 | 0 | 94.794 s |
| Express 4 ordinary | 364/364 | 0 | 16.240 s |
| Express 4 canonical | 366/366 | 0 | 18.156 s |
| ESLint | Passed | — | — |
| Documentation build | Passed | — | 4.634 s |

The final 239-file manifest still matches after the gate. Review confirmed that
the compiler, public request capability list, post-hook storage execution and
include ordering use the existing shared sort helpers. Dependency selection and
output filtering remain intact. The migration guide documents rejected hidden
sort configuration and the publicly readable `normallyHidden` alternative.
Package dependencies and the archived consumer migration patch are unchanged.
This resolves **A5-F9** in the metadata inventory; the broader A5 items and final
review checklist remain open.

## 2026-09-10: Shared pagination setup

**A6-05 is complete: 72/214 (33.6%), 142 open.** This completes shared ownership
of logical field selection, stable sorting and public pagination setup; it does
not complete the remaining metadata/capability validation or final whole-library
review. Consumer, seed and positioning implementations remain paused.

The new `conformance-pagination.test.js` reproduced ordinary storage executing
and discarding a count for the first size-only cursor page. Before correction,
**19/20 ordinary** and **20/20 canonical** cases passed
(`/tmp/library-pagination-before-{knex,anyapi}.log`). The failed assertion records
one count where zero is required; public cursor metadata never used that total.

Both plugins now call `applyPaginationToQuery` in the existing pagination helper.
It applies capped page size, mode, limit/offset, typed cursor parsing and the
existing scalar validation/predicate chain, then returns
`{ mode, page, pageSize, before }`. The plugins use that result for count and
response branches. Count SQL, physical row extraction, storage conversion and
authorization remain in their responsible modules. The change removes **211
net runtime lines** across the two plugins and helper, measured against
`/tmp/library-pagination-before-4glvwxe9`. No page DSL, adapter framework or
compatibility handling was added.

The 20 shared cases cover default/capped limits, offset/cursor mode selection,
counts on/off, default-size forward/backward boundaries, empty pages, retained
links, invalid numeric/conflicting inputs and typed malformed-cursor rejection
before SQL. The focused SQLite selection passes **387 ordinary / 383 canonical**
(`/tmp/library-pagination-focused-{knex,anyapi}.log`). The final test also fixes
the expected malformed-cursor message across both modes.

Frozen Node 24.6.0 `npm run verify` exits **0**
(`/tmp/library-pagination-final-gate.log`):

| Gate | Passed | Skipped | Duration |
| --- | ---: | ---: | ---: |
| Ordinary full suite | 3600/3601 | 1 existing skip | 95.805 s |
| Canonical full suite | 3633/3633 | 0 | 142.719 s |
| Express 4 ordinary | 364/364 | 0 | 27.674 s |
| Express 4 canonical | 366/366 | 0 | 28.199 s |
| ESLint | Passed | — | — |
| Documentation build | Passed | — | 4.521 s |

The nine-file native selection covers pagination, sort fields, queries, temporal
values, serializers, reference sorting, transitive field dependencies, include
limits and structured queries. It exits **0** with **3359 passed**, no failures,
skips or cancellations (`/tmp/library-pagination-final-native.log`):

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 559/559 | 560/560 | 49.151 / 56.171 s |
| PostgreSQL 16.15 | 559/559 | 561/561 | 131.278 / 106.262 s |
| MySQL 8.0.46 | 559/559 | 561/561 | 67.729 / 106.749 s |

Compilation/non-SQL cases contribute to these counts; existing reference/include
suites supply actual HTTP coverage. The frozen 238-file manifest is
`/tmp/library-pagination-final-source.sha256` and still matches after the gates.
The migration guide records page modes, count behavior and the unified cursor
syntax error. No dependency or parked consumer-patch changes were made.

| A6-05 responsibility | Current shared owner and evidence |
| --- | --- |
| Logical sort field/alias resolution | `resolveSortField`, used by sort builders, required selections, reference visibility and include ordering; previous 35-case sort-field suite remains in the native selection. |
| Required cursor/dependency fields | `buildFieldSelection` always selects logical ID and resolved sort fields and follows compiled dependencies; sparse alias/projection/temporal cursors and transitive callback tests execute on each database. |
| Stable ordering | `buildEffectiveSortList` and `normalizeStableSort` deduplicate sort keys and append logical ID; tie/null and both-direction traversal tests verify results and links. |
| Page inputs and execution rules | The shared request contract validates inputs/conflicts; `applyPaginationToQuery` owns mode, cap, limit/offset and cursor setup, using existing scalar/predicate helpers. |
| Public links and metadata | Both plugins use the existing pagination link/meta helpers with the shared effective page information. |

The review also reproduced an **open A5-03/A5-10 configuration/visibility defect**
with read-only fixture probes (`/tmp/library-hidden-sort-probe.log`). A hidden
projection with `sortable: true` exposes its selected scalar in cursor metadata
on both backends. An explicitly allowed hidden stored field instead produces
a cursor missing that field. The shared selection correctly withholds the
hidden attribute, but configuration/public sort eligibility currently permits
the contradictory declaration. Field-capability validation is the next fix;
this remained a known gap at that milestone. The
[hidden-sort correction above](#2026-09-10-hidden-sort-visibility) now resolves
this finding; final whole-library review remains open.

## 2026-09-10: Logical sort fields and cursor comparisons

**A6-05 remains in progress; 71/214 complete (33.2%), 143 open.** The shared
logical field portion is implemented and verified. The remaining page-mode,
page-size and cursor setup still repeats in the Knex plugins and is the next
bounded consolidation. No consumer or positioning implementation changed.

The new `conformance-sort-fields.test.js` initially passed **6/23** and failed
**17/23** on each storage mode (`/tmp/library-sort-fields-before-knex.log`,
`/tmp/library-sort-fields-before-anyapi.log`). Explicit search aliases redirected
sorting of `id` and real attributes; distinct sortable scalar aliases also
failed sparse cursor traversal. Object-shaped/other invalid default sorts
passed compilation despite the public query contract rejecting them. An earlier
read-only probe recorded the default-sort public failure separately in
`/tmp/library-default-sort-probe.log`.

`resolveSortField` now gives logical IDs, stored attributes and projections
precedence over filter aliases. Distinct aliases resolve once to their target.
Both sort builders, reference visibility queries, include ordering and required
field selection use this helper. Descriptors retain the actual logical field
and result column; ordinary cursor generation uses that selected value even
when the response omits the alias/attribute. SQL column/slot translation stays
in storage adapters. Their `translateCursorValue` uses stored metadata without
resolving filter aliases or invoking user callbacks; custom-serialized and
projection predicates retain direct SQL-value binding. Reference ID strings
remain intact. Shared default-sort parsing rejects non-string shapes during
compilation; it no longer has a private object parser inconsistent with queries.

The first corrected 23 cases pass in both modes. The final file has **35 cases**:
JSON:API/plain offset/forward/backward cursors, sparse fields, ID/name collisions,
scalar aliases, numeric/dateTime types with conflicting filter types, ties/nulls,
valid/invalid defaults and standard/window collection includes. One additional
direct adapter case verifies cursor scalar/relationship conversion without
serializer/getter calls. The eight-file intermediate SQLite selection passed
**487 ordinary / 488 canonical** before this final direct assertion.

Frozen Node 24.6.0 `npm run verify` exits **0**
(`/tmp/library-sort-fields-final-gate.log`):

| Gate | Passed | Skipped | Duration |
| --- | ---: | ---: | ---: |
| Ordinary full suite | 3580/3581 | 1 existing skip | 113.792 s |
| Canonical full suite | 3613/3613 | 0 | 117.575 s |
| Express 4 ordinary | 364/364 | 0 | 20.699 s |
| Express 4 canonical | 366/366 | 0 | 20.269 s |
| ESLint | Passed | — | — |
| Documentation build | Passed | — | 3.900 s |

The eight-file native selection covers sort fields, serializers, temporal
values, reference sorting, include limits, queries, direct storage boundaries
and structured queries. It exits **0** with **2933 passed**, no failures,
skips or cancellations (`/tmp/library-sort-fields-final-native.log`):

| Database | Ordinary | Canonical | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 488/488 | 489/489 | 54.286 / 63.269 s |
| PostgreSQL 16.15 | 488/488 | 490/490 | 107.706 / 71.568 s |
| MySQL 8.0.46 | 488/488 | 490/490 | 39.815 / 67.476 s |

Compilation and adapter checks are included in those counts; not every case
executes a public HTTP request. Existing reference/include suites supply actual
HTTP coverage on the selected databases. The 237-file runtime/test/config
manifest is `/tmp/library-sort-fields-final-source.sha256`. Migration and storage
guides describe the contract and existing cursors must restart after an affected
sort collision is corrected. No dependency changes or compatibility layer were
introduced. This is a verified incremental repair, not a final whole-patch audit.

## 2026-09-10: Structured query capabilities and PostgreSQL JSON selections

**A6-07 is complete.** Combined with the scalar serializer and structured
write/read batches below, supported writes, filters, cursors, projections and
reads now have an explicit serializer contract. Whole-object/array comparisons
and ordering are not portable generic operations. Local search/default-sort/
explicit-sort/projection declarations reject during compilation; related targets
reject when resolved, preserving forward resource declarations. Default sortable
fields exclude structured fields, and direct adapter filter conversion rejects
before invoking serializers, including null/empty-array operands. Scalar-field
`in` and `between` still work. Custom SQL predicates and scalar JSON-key
projections remain the supported extension points.

The shared field assertion and existing sort helper carry these checks;
compilation, cross-table resolution and adapters use the actual stored field
definition. No backend-emulation layer or new query DSL was added. New tests
cover both storage modes, custom/built-in JSON storage, scalar-key filters,
forward/backward scalar projection cursors with ties/nulls/sparse output,
configuration failures, related `actualField`/`oneOf`/empty-IN requests, and real
Express/Fastify JSON round trips and pre-SQL 422 sort errors.

A separate regression reproduced PostgreSQL `DISTINCT` failing to select JSON
attributes and JSON projections after a one-to-many filter joined duplicate
parents. `/tmp/library-structured-distinct-pg-before.log` passes **44/48** cases
and fails all four valid distinct-parent JSON cases with PostgreSQL's missing
JSON equality operator. Stored-field and projection selections now share
`normalizeStructuredSelect`, using `to_jsonb` on PostgreSQL. The public values
are preserved without altering existing tables. Structured custom encodings
must use JSON-compatible SQL representations; arbitrary binary SQL mappings
are outside this contract. Quoted physical JSON columns and serializer column
metadata are also exercised.

The first draft's cursor assertions incorrectly assumed previous-page metadata
and links; those were corrected against the existing directional cursor/link
contract. Other early runs caught test-fixture errors (a missing required search
index, a resource path written as a relationship alias, and a custom raw filter
using an unavailable SQL alias). These failures are not counted as production
regressions. The corrected three-file native selection passes **402 checks**:
66 ordinary / 68 canonical per database, with no failures, skips or cancellations.
Log: `/tmp/library-structured-queries-native2.log`. It includes real HTTP on both
connectors. The final matrix below expands this selection and uses quoted JSON
column mappings added during review.

Frozen Node 24.6.0 `npm run verify` exits **0**:

| Gate | Passed | Skipped | Duration |
| --- | ---: | ---: | ---: |
| Ordinary full suite | 3544/3545 | 1 existing skip | 118.077 s |
| Canonical full suite | 3577/3577 | 0 | 154.001 s |
| Express 4 ordinary | 364/364 | 0 | 22.128 s |
| Express 4 canonical | 366/366 | 0 | 27.938 s |
| ESLint | Passed | — | — |
| Documentation build | Passed | — | 7.382 s |

Log: `/tmp/library-structured-queries-final-gate.log`. The existing ordinary skip
is the canonical cursor-fixture cleanup case, which passes in canonical mode.
The new structured HTTP cases separately pass on Express 4: **2/2 per storage
mode**, zero failures/skips/cancellations, using `--import
./tests/helpers/select-express4.js` and the `Structured JSON HTTP express` name
pattern. Logs: `/tmp/library-structured-queries-express4-{knex,anyapi}.log`.

The nine-file native matrix exits **0**, with **2660 passed checks** and no
failures, skips or cancellations:

| Database | Ordinary invocation | Canonical invocation | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 426/426 | 460/460 | 42.048 / 56.135 s |
| PostgreSQL 16.15 | 426/426 | 461/461 | 100.809 / 119.374 s |
| MySQL 8.0.46 | 426/426 | 461/461 | 46.475 / 75.694 s |

Command: Node 24 `scripts/test-databases.js all` with
`conformance-structured-queries`, `conformance-structured-values`,
`structured-query-transport`, `conformance-serializers`, `conformance-queries`,
`conformance-field-dependencies`, `conformance-schema-enrichment`,
`conformance-include-adapters`, and `conformance-temporal`.
Every database fixture uses the selected driver. Counts include compilation
checks that do not themselves execute SQL. Log:
`/tmp/library-structured-queries-final-native.log`.

The **236-file** `/tmp/library-structured-queries-final-source.sha256` manifest
matches after all gates. The saved consumer patch and non-root lockfile package
hashes are unchanged. All disposable directories for the failed, focused and
final native invocations are removed. `git diff --check` passes. Final prose is
rebuilt after recording the results; no consumer verification was run.

Verified total: **71/214 (33.2%)**, with **143 open**; A **59/138**, B **10/48**,
M **2/14**, C **0/14**. This closes serializer consistency, not the remaining
storage-interface, metadata, capability-description, migration or final-review
items. Consumers, seeds and positioning remain untouched.

A read-only A6-05 follow-up found that public `defaultSort` accepts strings and
arrays, but a legacy object form accepted by the lower-level sort helper fails
the public request contract in both modes. `/tmp/library-default-sort-probe.log`
records the six SQLite observations. The next change should choose one contract
and remove the mismatch; this probe does not complete A6-05.

## 2026-09-10: Structured JSON writes and reads

A6-07 remains in progress. Native probes reproduced built-in array write
failures on ordinary SQLite, PostgreSQL and MySQL; canonical registration
rejected array types. Objects depended on incidental driver conversion, and
SQLite/canonical JSON text reached computed callbacks without decoding.
The probe log is `/tmp/library-structured-native-probe.log`; its four tests per
invocation deliberately captured operation errors, so its zero exit status is
not a passing conformance result.

The existing database value normalizer now serializes object/array values and
decodes JSON text before enrichment. A custom getter owns its stored
representation and runs before final shape checks. An initial implementation
rejected custom arrays before the getter decoded their wrapper; focused checks
caught this and the ordering was corrected. An unnecessary extra normalization
pass in `enrichAttributes` was removed. Canonical arrays use the existing JSON
slot pool. Only these two runtime modules changed in this batch.

Built-in writes reject wrong-shaped setter results and JSON serialization
failures before SQL, including with `returning: 'none'`. Existing error wrapping
preserves causes and field/resource context. The setter fixture and guide now
return objects, removing manual JSON-stringifying setters and string-valued
object response expectations. The migration guide covers public read values,
custom encodings and the still-unfinished query contract.

`conformance-structured-values` adds 12 ordinary / 14 canonical cases for
POST/PUT/PATCH, JSON:API/plain GET/query, custom/built-in object and array values,
empty/nested/null values, SQL projections, computed dependencies, invalid setter
output on all three write methods, stored shape errors, and canonical field
addition/descriptor reload. Early focused results were 27/29 in each mode;
after correcting getter order the scalar/dependency/structured selection passed
101/101 and 103/103. The extended setter/getter/computed/structured selection
then passed 62/62 in each mode. Initial lint reported six formatting issues;
they were fixed before the source manifest and full gate.

The four-file Node 24.6.0 native matrix exits **0**, with **738 passed checks**,
no failures, skips or cancellations:

| Database | Ordinary invocation | Canonical invocation | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 115/115 | 131/131 | 3.612 / 3.955 s |
| PostgreSQL 16.15 | 115/115 | 131/131 | 5.930 / 12.134 s |
| MySQL 8.0.46 | 115/115 | 131/131 | 8.407 / 22.761 s |

Command: Node 24 `scripts/test-databases.js all` with
`conformance-structured-values`, `conformance-serializers`,
`conformance-field-dependencies`, and `conformance-include-adapters`.
Each database fixture uses the selected driver. Counts include compilation
checks that do not themselves execute SQL. Log:
`/tmp/library-structured-native.log`. Both disposable native directories,
`/tmp/jra-db-xIfYlB` (probe) and `/tmp/jra-db-c4iWLv` (matrix), are removed.

Node 24.6.0 `npm run verify` exits **0**:

| Gate | Passed | Skipped | Duration |
| --- | ---: | ---: | ---: |
| Ordinary full suite | 3490/3491 | 1 existing skip | 71.338 s |
| Canonical full suite | 3523/3523 | 0 | 86.989 s |
| Express 4 ordinary | 364/364 | 0 | 21.431 s |
| Express 4 canonical | 366/366 | 0 | 24.842 s |
| ESLint | Passed | — | — |
| Documentation build | Passed | — | 3.368 s |

Log: `/tmp/library-structured-gate.log`. The ordinary skip is the existing
canonical-only cursor cleanup case, which passes in canonical mode.
The 234-file `/tmp/library-structured-source.sha256` manifest matched all
runtime/test/script/configuration files after this full gate and native matrix.

A review then strengthened one test assertion: the supplied input is cloned
independently of its expected value, making the mutation check meaningful.
No runtime, fixture or configuration code changed. The reviewed source manifest
is `/tmp/library-structured-reviewed-source.sha256`. The structured-only native
matrix exits **0**: **12 ordinary / 14 canonical on each database, 78 checks**,
with no failures, skips or cancellations. Log:
`/tmp/library-structured-reviewed-native.log`. Focused ESLint also passes. This
test-only follow-up is separate from the full gate above; the only manifest
change is the independent input copy in `conformance-structured-values.test.js`.
The reviewed 234-file manifest matches. The saved consumer patch and non-root
lockfile package hashes remain unchanged. The follow-up's disposable directory
`/tmp/jra-db-06wSUZ` is removed. Final prose is rebuilt after recording results.

**70/214 complete (32.7%); 144 open.** A6-07 remains unchecked. The native probe
also reproduced whole-document equality/order/cursor differences: PostgreSQL
JSON lacks the operators used by generic comparisons, MySQL native JSON and
canonical text compare differently, cursor text fails structured validation,
and array equality sends elements through the serializer separately. Those
query capabilities still need an explicit contract and enforcement. The related
PostgreSQL cross-table DISTINCT path needs a separate reproduction before any
claim or fix. Consumers, seeds and positioning source remain untouched.

## 2026-09-10: Serializer cursors and projection callbacks

A6-07 is in progress. Scalar serializer checks reproduced double serialization
when following a generated cursor: prefixed strings skipped records and scaled
numbers traversed incorrectly. Ordinary relationship writes also serialized
foreign keys, while canonical writes bypassed that callback but filters invoked
it. The initial 24-case suite passed only two cases in each storage mode; 12
cursor cases and 10 expected schema rejections failed.

Custom-serialized attributes now compare their stored cursor value without
calling the write serializer. Canonical sorting takes callable metadata from
the compiled field definition rather than its persisted JSON copy. Projections
likewise compare the selected SQL value directly; their obsolete `storage`
option now rejects compilation. Identity and relationship ID/type fields reject
custom serializers before metadata publication. A failed canonical field
addition preserves compiled metadata, registry rows and records.

Projection getters were silently ignored. They now join the existing compiled
getter dependency graph, including async completion, hidden dependencies,
computed output ordering and original failure causes. Projection setters are
rejected because projections are read-only. The shared storage serializer also
rejects returned Promises before SQL and consumes any eventual rejection;
POST/PUT/PATCH with no returned record and scalar/array filters exercise this
contract. No additional lifecycle engine or compatibility path was introduced.

The first full gate found six regressions in numeric SQL projection cursors.
SQLite expressions do not apply a column's numeric affinity to string bindings.
The corrected validator retains SQL temporal spelling while binding scalar
numbers and numeric temporal epochs as numbers. Existing `doubleRank` and
related traversal cases now pass; a new arithmetic temporal projection covers
the same boundary. A null array-filter expectation was also corrected: SQL
`IN (NULL)` does not match a null row, while scalar equality uses `IS NULL`.

Evidence before the corrected final gates:

- `/tmp/library-relationship-serializer-probe.log` and
  `/tmp/library-scalar-serializer-cursor-probe.log`: original reproductions.
- `/tmp/library-serializers-before-{knex,anyapi}.log`: **2/24 passed** each.
- `/tmp/library-serializers-async-before-{knex,anyapi}.log`: Promise values reach
  SQLite bindings, and explicitly selected projection getters remain ignored.
- `/tmp/library-serializers-final-gate.log`: ordinary **3468/3475 passed**,
  **6 failed**, one existing skip; later stages did not execute.
- `/tmp/library-serializers-final-native.log`: the earlier selected native files
  pass **1721 checks**, but omit the arithmetic cases found by the full gate.
  This is superseded by the corrected, expanded matrix below.
- `/tmp/library-serializers-numeric-focused-{knex,anyapi}.log`: **378/378** and
  **410/410** passed, no failures/skips/cancellations. These focused invocations
  include direct cursor unit tests and SQLite-only historical projection tests.

Corrected Node 24.6.0 `npm run verify` exits **0**:

| Gate | Passed | Skipped | Duration |
| --- | ---: | ---: | ---: |
| Ordinary full suite | 3478/3479 | 1 existing skip | 80.471 s |
| Canonical full suite | 3509/3509 | 0 | 113.508 s |
| Express 4 ordinary | 364/364 | 0 | 21.292 s |
| Express 4 canonical | 366/366 | 0 | 22.679 s |
| ESLint | Passed | — | — |
| Documentation build | Passed | — | 7.597 s |

Log: `/tmp/library-serializers-final2-gate.log`. The existing ordinary skip is
the canonical-only cursor fixture cleanup case, which passes in canonical mode.
The expanded native matrix exits **0**, with **2309 passed checks** and no
failures, skips or cancellations:

| Database | Ordinary invocation | Canonical invocation | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 368/368 | 401/401 | 26.584 / 34.720 s |
| PostgreSQL 16.15 | 368/368 | 402/402 | 50.053 / 99.918 s |
| MySQL 8.0.46 | 368/368 | 402/402 | 42.768 / 92.960 s |

Command: Node 24 `scripts/test-databases.js all` with
`conformance-serializers`, `conformance-queries`, `conformance-temporal`,
`conformance-field-dependencies`, `conformance-schema-enrichment`,
`conformance-include-adapters`, and `conformance-storage-boundaries` test files.
Each file's database fixtures use the selected driver. Counts also include
compilation/normalization assertions that do not themselves issue SQL.
The runner uses PostgreSQL 16 and MySQL binaries through the documented
`JSON_REST_API_POSTGRES_BIN`, `JSON_REST_API_MYSQL_BIN`, and `LD_LIBRARY_PATH`
overrides. Log: `/tmp/library-serializers-final2-native.log`.

Runtime/test/script sources remain identical to the 225-file manifest
`/tmp/library-serializers-final2-source.sha256`. The saved consumer patch and
non-root lockfile package hashes remain unchanged. No consumer verification was
run. Final prose is rebuilt separately after recording these results.

A6-07 remains open for structured-value serialization and explicit capability
boundaries. `/tmp/library-structured-serializer-probe.log` reproduces a generated
object cursor that the next request rejects in both storage modes. The expanded
`/tmp/library-structured-serializer-details.log` confirms SQLite object write/
filter round trips, then cursor validation failure in both modes. An ordinary
array round trip succeeds, but equality-filter translation invokes its serializer
on each element, and following its cursor sends an array to SQLite bindings.
Canonical registration explicitly rejects the array field type. These probes
do not establish PostgreSQL/MySQL structured-value support. Consumer,
seed and positioning source remains untouched. Verified checklist completion
remains **70/214 (32.7%)**, with **144 open**.

## 2026-09-10: Direct storage boundaries and declared primary IDs

A6-03 adds direct adapter checks backed by real compiled resource metadata.
After fixture registration, assertions call the adapter and Knex without resource
method orchestration. They cover quoted mappings/result aliases and bound values;
logical/physical row extraction; numeric, boolean, ID and text scalar/array/null
comparisons; search-value aliases; custom write/filter serialization metadata;
nonstored-field exclusion; relationship nulling; independent builders; borrowed
transaction rollback; invocation-local hook lookup; and canonical tenant/resource
constraints on reads, updates and deletes. The existing cold-resource seed helper
now reuses `seedStorageAdapterRecords` so test setup does not warm cached adapters.

The ordinary fixture exposed a table-schema defect before adapter assertions
could run: `resolveTableSchemaContext` recognized the configured physical ID only
when the field's type was `id`. Declared integer/string primary IDs consequently
produced duplicate generated ID columns in direct and generated DDL. The shared
decision now resolves that field by its physical mapping, regardless of its schema
type. An incompatible implicit numeric allocator for an opaque ID rejects before
DDL generation; `primary: true` and explicit `autoIncrement: false` have tested
outcomes. No adapter implementation or new abstraction was needed.

After that correction, snapshots still rejected manual integer IDs and all string
IDs. Snapshot validation now accepts non-null, single-column integer/string
primary keys without requiring a database default or allocator. It continues to
report actual allocation/default metadata and reject missing, nullable,
non-primary, floating-point and composite resource IDs. Direct and generated DDL
checks insert zero/opaque IDs, reject duplicates and require an empty diff for the
unchanged schema. Existing tables are not altered automatically. The migration
and schema guides explain the supported declaration and snapshot change.

Evidence before final gates:

- `/tmp/library-storage-boundaries-primary-before.log`: **4 failed DDL cases**,
  with **7 adapter cases cancelled** because fixture creation fails with a
  duplicate physical ID column. Both integer/string and direct/generated creation
  paths reproduce it.
- `/tmp/library-storage-boundaries-focused-{regular,canonical}.log`: after the
  table-ID detection fix, four snapshot assertions fail because the old snapshot
  contract requires generated integer IDs. Adapter cases pass.
- Final focused files pass **96/96 ordinary invocation** and **108/108 canonical
  invocation**, with no skips or cancellations. These include the SQLite-only
  legacy introspection/table-helper suites and ordinary DDL cases in both
  invocations, rather than representing exclusively one storage backend.
  Logs: `/tmp/library-storage-boundaries-final-focused-{regular,canonical}.log`.
- Focused ESLint passes: `/tmp/library-storage-boundaries-final-lint.log`.

Final Node 24.6.0 `npm run verify` exits **0**:

| Gate | Passed | Skipped | Duration |
| --- | ---: | ---: | ---: |
| Ordinary full suite | 3435/3436 | 1 existing skip | 83.003 s |
| Canonical full suite | 3465/3465 | 0 | 104.697 s |
| Express 4 ordinary | 364/364 | 0 | 12.575 s |
| Express 4 canonical | 366/366 | 0 | 12.979 s |
| ESLint | Passed | — | — |
| Documentation build | Passed | — | 2.129 s |

Log: `/tmp/library-storage-boundaries-final-gate.log`. The ordinary skip is the
existing canonical-only cursor fixture cleanup test, which passes in the
canonical invocation.

The native matrix exits **0**, with **945 passed checks**, no failures, skips
or cancellations:

| Database | Ordinary invocation | Canonical invocation | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 148/148 | 161/161 | 11.978 / 12.359 s |
| PostgreSQL 16.15 | 155/155 | 168/168 | 26.563 / 30.159 s |
| MySQL 8.0.46 | 150/150 | 163/163 | 35.925 / 54.261 s |

All selected files use the requested database. The DDL/snapshot/field-alteration
suites deliberately exercise ordinary storage in both invocations; adapter, ID
and include conformance use the selected storage mode. Database-specific schema
capabilities account for the different test totals. Log:
`/tmp/library-storage-boundaries-final-native.log`. Reproduce with Node 24 and
the native binary environment recorded in this verification log:

```sh
node scripts/test-databases.js all \
  tests/conformance-storage-boundaries.test.js \
  tests/db-schema-conformance.test.js tests/db-field-alterations.test.js \
  tests/conformance-ids.test.js tests/conformance-include-adapters.test.js
```

All **224** runtime/test/script/package hashes in
`/tmp/library-storage-boundaries-final-source.sha256` match after both gates.
Runtime and test source stayed frozen during the gates; the disposable
`/tmp/jra-db-9DdtbJ` directory was removed. `git diff --check` passes. The parked
jskit-ai patch and non-root dependency entries retain their prior hashes. This
batch changed no consumer, seed, positioning or dependency files.

**A6-03 is complete.** The full checklist is **70/214 (32.7%)**, with 144 open.
Adapter typing, serializer equivalence, proxy migration and other A6 acceptance
requirements remain independently open.


## 2026-09-09: Include field selection and adapter initialization

A6-14 testing found three ordinary-storage include paths that bypassed field
selection when the target had no sparse fieldset: belongsTo, hasOne and
polymorphic belongsTo. Their raw column selection omitted SQL projections and
therefore supplied missing projected dependencies to computed fields. The
failure occurred both before and after the target's first direct GET.
Collection includes and canonical includes already used field selection.

All three paths now always call the existing `buildFieldSelection` and
`applyFieldSelectionToQuery` helpers. Logical-ID aliases, visible fields,
projections and callback dependencies follow the same rules in full and sparse
includes. This removes conditional bypasses without adding a helper, adapter,
cache or compatibility path. The existing target query-policy boundary remains
in place. The projection and migration guides describe the response correction.

`conformance-include-adapters.test.js` uses the existing ID conformance fixture
and a physical-row seed helper that leaves ordinary resource adapters cold.
Across six relationship kinds it checks custom ID/column mappings, zero IDs,
GET/query, plain/JSON:API, full/sparse projected and computed fields, and mapped
row-policy predicates. Each request asserts whether the ordinary target adapter
is still absent or has been initialized by a direct target read; tests do not
artificially delete caches. Hidden targets disappear from includes and linkage.

Canonical registration attaches adapters eagerly. Twelve additional cases
verify that supported field additions replace the attached adapter and return
new stored/getter/computed values through includes before another direct target
read. The suspected stale adapter after `addKnexFields` was not reproduced:
`refreshStorageDescriptor` already refreshes it. Ordinary `addKnexFields` alters
a table rather than recompiling a live resource, and is documented accordingly.

Projection failure tests now exercise full nested includes and full collection
queries as well as sparse GETs. Owned PATCH failures use full includes and
verify rollback; borrowed PATCH failures retain sparse includes and verify the
caller still owns the transaction. Typed and non-Error causes remain covered.

Evidence before final gates:

- Corrected before-fix regression: ordinary **6 pass / 6 fail**; canonical
  **12/12 pass**. The ordinary failures identify the three to-one paths in both
  query orders. Logs: `/tmp/library-include-adapters-before-corrected-{regular,canonical}.log`.
- Initial focused include/dependency/permission/failure/limit/projection/nested
  checks: **344/344 ordinary**, **345/345 canonical**, no skips or cancellations.
  These runs preceded the extra policy and canonical refresh assertions.
  Logs: `/tmp/library-include-adapters-focused-{regular,canonical}.log`.
- Final adapter/failure tests: **112/112 ordinary**, **124/124 canonical**, no
  skips or cancellations. Logs:
  `/tmp/library-include-adapters-failures-{regular,canonical}.log`.
- Final focused lint passes after correcting test/fixture object layout.
  Log: `/tmp/library-include-adapters-final-lint.log`.

Final Node 24.6.0 `npm run verify` exits **0**:

| Gate | Passed | Skipped | Duration |
| --- | ---: | ---: | ---: |
| Ordinary full suite | 3416/3417 | 1 existing skip | 90.364 s |
| Canonical full suite | 3445/3445 | 0 | 103.358 s |
| Express 4 ordinary | 364/364 | 0 | 14.504 s |
| Express 4 canonical | 366/366 | 0 | 16.424 s |
| ESLint | Passed | — | — |
| Documentation build | Passed | — | 4.150 s |

The ordinary skip is `cleans cursor fixture records from AnyAPI canonical
storage`; it runs and passes in the canonical suite. Log:
`/tmp/library-include-adapters-final-gate.log`.

The targeted database runner exits **0**, with **2097 checks passed**, no
failures, skips or cancellations:

| Selected database | Ordinary invocation | Canonical invocation | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 343/343 | 356/356 | 30.921 / 40.924 s |
| PostgreSQL 16.15 | 343/343 | 356/356 | 63.702 / 79.576 s |
| MySQL 8.0.46 | 343/343 | 356/356 | 24.674 / 44.502 s |

These are invocation totals. `projected-fields.test.js` (8 cases),
`nested-includes.test.js` (6) and `include-traversal.test.js` (10) use fixed
SQLite instances in every invocation. The five conformance files below use the
selected native database: **319 ordinary-invocation and 332 canonical-invocation
cases per database**. The canonical invocation includes 12 intentionally ordinary
pivot-policy cases; canonical link storage has no declared ordinary pivot
resource. The new adapter/refresh tests and the updated full-include failure
tests run against each selected database and storage mode.

Log: `/tmp/library-include-adapters-final-native.log`. Reproduce with Node 24
and the native binary environment recorded in this log:

```sh
node scripts/test-databases.js all \
  tests/conformance-include-adapters.test.js \
  tests/conformance-field-dependencies.test.js \
  tests/conformance-include-failures.test.js \
  tests/conformance-include-permissions.test.js \
  tests/conformance-include-limits.test.js \
  tests/projected-fields.test.js tests/nested-includes.test.js \
  tests/include-traversal.test.js
```

All **223** runtime/test/script/package hashes in
`/tmp/library-include-adapters-final-source.sha256` match after the gates; no
runtime or test file changed during them. The runner removed
`/tmp/jra-db-sG59gT`. The parked jskit-ai patch and non-root dependency entries
retain their previously recorded hashes. This batch changed no consumer,
seed, positioning or dependency file.

**A6-14 is complete.** The full checklist is **69/214 (32.2%)**, with 145 open.


## 2026-09-09: Cursor validation contract reuse

A5-07 implementation reuses cursor scalar contracts in the existing sort helper.
A WeakMap owns each cache by the resource's compiled `schemaInstance`. A schema
factory captures that instance's type/validator snapshots; normalized scalar
definitions select cached contracts. The key includes type, no-trim behavior,
nullable behavior and optional temporal precision. Invalid/noninteger precision
and non-string type declarations bypass JSON-keyed reuse. No cursor value,
request context, result, error, authorization decision or SQL expression is cached.
Both storage plugins pass their active compiled schema. New compilation selects
a new cache; a descriptor-only refresh retains the unchanged schema's cache.

Temporal output validation already reused contracts by type and precision, so
its runtime code is unchanged. Its conversion/truncation rules remain separate
from cursor validation. The source review also found that the old cursor helper
captured global type handlers afresh on each call, disagreeing with the resource's
compiled schema after a handler was replaced. Two new regression assertions
failed before the change, for both warmed and first-use cursor contracts. The
migration guide records the selected initialization boundary and the added
owning-schema argument for direct internal helper callers.

Evidence before final gates:

- `/tmp/library-cursor-contracts-before.log`: **5 pass, 2 fail**. The failures
  reproduce cursor validation switching to handlers registered after its owner
  was compiled.
- The first focused query/temporal/pagination/projection runs pass **259/260
  ordinary** (one existing skip) and **259/259 canonical**. These runs contained
  the first seven contract tests; three additional ownership/key/reentrancy
  cases were added afterward. Logs:
  `/tmp/library-cursor-contracts-focused-{regular,canonical}.log`.
- `/tmp/library-cursor-contracts-unit.log`: all **10/10** final contract tests
  pass. They cover result/input isolation, error recovery, nullable and opaque
  IDs, whitespace, field types/precision, absent/inherited values, type and
  validator snapshots, reentrant validation, invalid precision keys and output
  conversion separation.
- `node scripts/measure-cursor-validation.js` on Node 24.6.0 validates four
  fields, warms 1,000 calls, then measures five rounds of 10,000 calls and checks
  the results. Before medians: **1241.358 ms**; after: **85.768 ms** (about 14.5×
  faster for this isolated operation). Before rounds were 1529.783, 1414.433,
  1241.358, 1153.357 and 1090.203 ms; after rounds were 88.415, 86.851, 85.768,
  85.453 and 75.909 ms. Logs:
  `/tmp/library-cursor-contracts-benchmark-{before,after}.json`.
  These measurements exclude database work and do not establish query throughput.

Final Node 24.6.0 `npm run verify` exits **0**:

| Gate | Passed | Skipped | Duration |
| --- | ---: | ---: | ---: |
| Ordinary full suite | 3404/3405 | 1 existing skip | 74.981 s |
| Canonical full suite | 3421/3421 | 0 | 105.914 s |
| Express 4 ordinary | 364/364 | 0 | 14.267 s |
| Express 4 canonical | 366/366 | 0 | 12.818 s |
| ESLint | Passed | — | — |
| Documentation build | Passed | — | 4.263 s |

Log: `/tmp/library-cursor-contracts-final-gate.log`. Focused lint also passes;
its first run requested a `const` declaration in the nested-validation test,
which was corrected before the final source freeze.

The native matrix exits **0**, with **2195 passes**, three existing skips and
no failures or cancellations:

| Database | Ordinary invocation | Canonical invocation | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 356/357 | 375/375 | 21.219 / 33.247 s |
| PostgreSQL 16.15 | 356/357 | 376/376 | 61.280 / 79.401 s |
| MySQL 8.0.46 | 356/357 | 376/376 | 28.621 / 50.660 s |

Each ordinary skip is the canonical-only cursor fixture cleanup check in
`pagination-cursor-multifield.test.js`; it runs in the canonical invocations.
The field-evolution suite deliberately exercises canonical storage regardless
of invocation, so these totals are not exclusively ordinary-backend cases.
Log: `/tmp/library-cursor-contracts-final-native.log`. Reproduce the targeted
selection with Node 24 and the native binary environment recorded below:

```sh
node scripts/test-databases.js all \
  tests/cursor-value-contracts.test.js tests/conformance-queries.test.js \
  tests/conformance-temporal.test.js tests/pagination-cursor-multifield.test.js \
  tests/projected-fields.test.js tests/conformance-reference-sorting.test.js \
  tests/anyapi-field-evolution.test.js tests/conformance-schema-enrichment.test.js
```

All **221** runtime/test/script/package hashes in
`/tmp/library-cursor-contracts-final-source.sha256` match after both gates.
No runtime or test file changed during these gates. The runner removed
`/tmp/jra-db-s7yDVX`; `git diff --check` passes. The parked jskit-ai patch and
non-root dependency entries retain the hashes recorded in the preceding batch.
No consumer, seed, positioning or dependency file was changed by this batch.

**A5-07 is complete.** The separate source inventory below also completes
**A6-01**, bringing the full checklist to **68/214 (31.8%)**, with 146 open.

## 2026-09-09: Core storage-operation inventory

[Storage boundaries](storage-boundaries.md) completes A6-01 by mapping actual
resource-method/helper calls, adapter methods, query helpers and relationship
writers to the required storage operations. It covers field/ID/value translation,
selection, filters, ordering, pagination/counts, scoped reads, resource writes,
relationship membership/locks/changes and transaction handoff. Each row identifies
existing owners and the values crossing the boundary.

The inventory records ordinary/canonical differences, the query proxy's separate
role, fallback/attached adapter lifetimes and known adjacent callers. In particular,
positioning uses `adapter.selectColumns`, and the canonical count helper has a
direct row-policy test caller. These are reasons to inventory callers before
removing APIs. This source audit does not complete proxy-surface migration,
serialization equivalence, typings or the remaining A6 tests.

All linked source files were checked to exist, and the documentation build passes.
No storage implementation was changed as part of this inventory. Consumer and
positioning work remain paused.


## 2026-09-09: Compiled dependencies, projections and virtual input ownership

A5-04 now has a shared compiled dependency graph. `compileFieldDependencies`
reuses the existing topological sorter for getter/setter/computed ordering and
validates dependency shapes, missing names, cycles, callback types and stage
availability. Ordinary input fields without callbacks are valid prerequisites.
The unused `sortFieldsByDependencies` wrapper was removed. Field selection and
enrichment reuse `getFieldDependencyClosure` to follow only required edges;
read requests do not compile or sort dependencies again.

Sparse reads fetch transitive stored and projected inputs. Getter results feed
computations, and intermediate computed results feed later computations in
both `attributes` and `record`. Selected/required callbacks run once per record.
Explicit private dependencies are allowed, while hidden and unselected fields
are removed from output. Logical IDs use callback `id`. Read dependencies on
relationship aliases/backing fields are rejected because those values are
linkage rather than callback attributes. Setters retain available-input-only
semantics; this change adds no reads for missing PATCH attributes.

Projection declarations now enter through `schema:enrich`, are normalized and
validated against the final namespace, and live in `schemaInfo.queryFields`.
All runtime projection consumers were migrated; no separate old-path copy
remains. Canonical additions rebuild projections and dependencies, and reject
new stored/computed/relationship collisions before publication. Label candidate
selection excludes relationship backing fields using the existing shared helper.

The virtual-field review found write input leaking onto included records with
the same field name. Full write-response reads now receive the written ID in a
copy of the input document, and virtual enrichment checks primary-resource
ownership, type and ID. Getters see selected/required virtual input before
computations, with an original-value snapshot. Sparse virtual getters fetch their
dependencies, and unused virtual input does not trigger callbacks. Existing
null/undefined omission is retained.

New conformance coverage exercises chained/shared prerequisites, reversed
field/declaration order, async order and failures, sparse/full output in both
formats, main/included records, private dependencies, custom logical IDs,
projections, virtual input, canonical field additions and rejected candidates.
POST/PATCH/PUT owner checks cover same-type and different-type includes; inherited
GET/query contexts cannot copy another resource's input. The migration guide and
field/projection/plugin/label guides document the resulting contract.

Reproduction and focused checks:

- The earlier computed-chain probe is
  `/tmp/library-computed-dependencies-probe.log`; both full and sparse output
  observed undefined intermediate input before the correction.
- `/tmp/library-virtual-owner-clean-before.log` passes one existing case and
  fails seven ownership assertions before the fix. The initial draft used
  JSON:API input with plain format in three cases; those payloads were corrected
  before the clean reproduction. `/tmp/library-virtual-selection-before.log`
  passes eight cases and fails the unused-virtual-getter regression before its
  selection fix.
- Final focused suites pass **193/193 ordinary** and **213/213 canonical** on
  Node 24.6.0: dependency conformance, labels, computed fields, getters, setters,
  virtual fields, projections and schema enrichment. Logs:
  `/tmp/library-field-dependencies-reviewed-focused-{regular,canonical}.log`.

The final Node 24.6.0 `npm run verify` exits **0**:

| Gate | Passed | Skipped | Duration |
| --- | ---: | ---: | ---: |
| Ordinary full suite | 3394/3395 | 1 existing skip | 79.384 s |
| Canonical full suite | 3411/3411 | 0 | 93.591 s |
| Express 4 ordinary | 364/364 | 0 | 17.022 s |
| Express 4 canonical | 366/366 | 0 | 16.602 s |
| ESLint | Passed | — | — |
| Documentation build | Passed | — | 3.417 s |

Log: `/tmp/library-field-dependencies-final-gate.log`. This gate includes the
ordinary/canonical integration tests and their actual Express/Fastify coverage;
Express 4 is additionally selected by the dedicated compatibility command.

The targeted native matrix exits **0**, with **3,024 passes**, no failures,
skips or cancellations:

| Database | Ordinary invocation | Canonical invocation | Durations |
| --- | ---: | ---: | --- |
| SQLite 3.49.2 | 494/494 | 514/514 | 32.852 / 37.906 s |
| PostgreSQL 16.15 | 494/494 | 514/514 | 61.966 / 73.993 s |
| MySQL 8.0.46 | 494/494 | 514/514 | 30.715 / 84.712 s |

The matrix runs dependency conformance, labels, computed fields, getters,
setters, virtual fields, projections, schema enrichment, field evolution,
fieldsets, include permissions, reference sorting and post-write read failures.
The field-evolution suite deliberately exercises canonical storage in both
invocations; the invocation totals are not claims that every case selects the
ordinary backend. Log: `/tmp/library-field-dependencies-final-native.log`.
The runner removed its disposable root `/tmp/jra-db-Iqpala`.

Reproduce with Node 24 selected using `npm run verify`, and run
`node scripts/test-databases.js all` with the thirteen test paths from the
matrix command. The native binary environment is the same as the previous
schema-enrichment gate recorded below. No consumer check was run.

The frozen runtime/test/script/package manifest is
`/tmp/library-field-dependencies-final-source.sha256` (219 files). All hashes
match after both final gates; no runtime or test file changed while they ran.
`git diff --check` passes. The parked jskit-ai patch retains SHA-256
`81c454022208ba2c1bc8d2a893a4e3eb9d7d5c8b09d8e86a4bf435ea9b6e2d3e`;
non-root lockfile entries retain
`cae30198723b6cb1f4d1606558b5920bdf5d393a7ae5a7e121037e84252a1973`.

**A5-04 is complete: 66/214 (30.8%), 148 open.** Broader A5 metadata,
configuration lifetime, measurement and consumer criteria remain open.
jskit-ai, vibe64, seeds and positioning remain paused.


## 2026-09-09: Computed enrichment and label recompilation

LabelPlugin now derives its computed label inside the existing compiler through
`computedSchema:enrich`, after attribute/search enrichment and before metadata
publication. Canonical field additions rebuild candidates rather than dropping
labels or copying stale definitions. The hook accepts additions, mutations,
deletions and replacement of computed declarations and is awaited. Definitions
are validated together; stored/computed name collisions reject compilation.
Failed candidate compilation leaves the active schema and stored rows intact.

A separate public probe found falsy non-function `compute` declarations silently
omitted their fields. Supplied non-functions now reject registration; omitting
`compute` remains valid for deliberately hook-supplied values. The migration
guide documents both the computed enrichment boundary and callback validation.
No consumer repository or positioning implementation changed.

Final focused Node 24.6.0 checks pass **125/125 ordinary** and **144/144 canonical**,
covering schema enrichment, labels, computed fields, getters and setters:
`/tmp/library-computed-enrichment-final-focused-{regular,canonical}.log`.
The final `npm run verify` exits **0**: ordinary **3342/3343** (one existing
skip), canonical **3358/3358**, Express 4 **364/364 ordinary** and
**366/366 canonical**, lint and documentation. Raw output is
`/tmp/library-computed-enrichment-final-gate.log`.

The targeted SQLite/PostgreSQL/MySQL matrix exits **0** with **585 passes**,
no failures, skips or cancellations: **88 ordinary-invocation / 107
canonical-invocation checks per database**. It runs schema enrichment, labels
and canonical field-evolution suites. The field-evolution suite deliberately
uses canonical storage in both invocations; the invocation counts are not
claims that those cases use ordinary storage. Versions remain SQLite 3.49.2,
PostgreSQL 16.15 and MySQL 8.0.46. The final log is
`/tmp/library-computed-enrichment-final-native.log`; its disposable root was
`/tmp/jra-db-R71VUc`.

Earlier drafts corrected a test helper that inspected query options after the
operation had populated them, and a misspelled slot-map variable. The first
negative callback tests needed cleanup when an expected registration rejection
did not occur; their SQLite child was stopped and the helper now closes even
unexpectedly successful fixtures. The clean pre-fix callback run exits with
**4 passes / 8 expected failures** in
`/tmp/library-computed-callback-clean-before.log`. The first native run picked
up these additional cases during its final MySQL invocation and failed those
same eight cases. It is not final-source verification. Both final gates use
the corrected tests and validation; the source manifest is
`/tmp/library-computed-enrichment-final-source.sha256`.

All 218 recorded source hashes still match. `git diff --check` passes; parked
migration-patch and non-root dependency-entry hashes remain unchanged. A final
documentation rebuild after recording these results is logged in
`/tmp/library-computed-enrichment-final-docs.log`.

The next A5-04 probe shows computed-to-computed dependencies returning
`'undefined!'` in full and sparse reads on both storage modes, despite the
dependency's full response value being present. See
`/tmp/library-computed-dependencies-probe.log` and the metadata inventory.
Execution order, dependency closure and passing computed results to later
callbacks require a coordinated fix; this probe does not complete that work.

This resolves A5-F5 and A5-F6, but does not finish A5-04's dependency graph,
visibility and execution-order requirements. **65/214 (30.4%) remain complete;
149 remain open.**

## 2026-09-09: Dependency and extension recompilation probes

After the completed schema/contract batch, a Node 24 public API probe reproduced
LabelPlugin losing its computed label after an unrelated canonical
`addKnexFields` call. GET returns the label before addition and omits it after;
`schemaInfo.computed` no longer contains it. This is now A5-F5 in the
[metadata inventory](compiled-resources.md), with regression acceptance and raw
output `/tmp/library-label-recompile-probe.log`. It was subsequently fixed in
the computed-enrichment batch above.

A separate registration probe showed getter/setter ordering dependencies on an
existing field without the corresponding callback failing in the sorter. The
allowed dependency contract and sparse-selection behavior need a deliberate
decision under A5-04; `/tmp/library-field-dependency-probe.log` records both
rejections. No production source changed during these probes.

The local parked-migration README was corrected to distinguish the resumed
library goal from still-paused consumer work. Its patch/manifest and all
consumer repositories remain unchanged. Documentation is rebuilt in
`/tmp/library-dependency-probes-docs.log`. No checklist item is completed by
these findings: **65/214 (30.4%) complete; 149 remain**.

## 2026-09-09: Schema enrichment, canonical metadata and connector contracts

`compileSchemas` now passes a separate generated search map to
`searchSchema:enrich`, runs the hook for an initially empty map, applies index
hints after enrichment and compiles its final result. Additions, mutations,
deletions and complete replacements no longer alter the attribute schema.

Canonical registration now uses compiled field/computed/relationship
definitions for allocation. `refreshStorageDescriptor` replaces the previous
rehydration function: it attaches the descriptor while preserving compiled
schemas, callbacks and search overrides. The second `createSchema`/search
generation path is removed. Canonical field additions still compile a candidate
and publish after allocation commits; repeated table creation only refreshes
the descriptor. Expanded declarations/callbacks remain required in source for
restart, as the registry's registration replaces persisted declarations.

The real HTTP probe distinguished ordinary added attributes, which already
worked after Fastify startup, from added relationship aliases, which Fastify
rejected with 422 while programmatic calls and Express accepted them. Fastify's
validator now resolves the current cached request contract per payload.
POST/PUT/PATCH cover the new alias and invalid-cardinality rejection. Exported
route JSON Schema remains an initialization snapshot. Existing
`fastify-plugin.test.js` checks exported body fields and relationship schemas
against the shared authored request contracts; stateful authorization and
database checks remain in the core.

Using enriched definitions can change existing canonical allocations. The
registry now compares old/new field slots in its metadata transaction and
rejects removal/remapping while the resource has records. The regression suite
checks changed pools, removal and reordered slots, unchanged rows/configuration
after rejection, empty-resource changes, and successful reordering/addition with
preserved explicit slots. This is a migration guard, not a data conversion or a
general guarantee about semantic changes retaining the same physical layout.

`conformance-schema-enrichment.test.js` contains **8 shared cases plus 12
canonical cases**, using a new shared fixture with pre-registration hooks.
The four connector commands include it; the Express 4 pattern selects its real
Express suite. The [API migration guide](../GUIDE/MIGRATING_API_V2.md#schema-enrichment-and-canonical-registration)
documents hook-map correction, canonical metadata/ID allocation, configuration
timing and migration steps. The [metadata inventory](compiled-resources.md)
tracks A5-F1–A5-F4 and remaining dependency/projection/initialization work.

Draft test corrections are explicit: the first assertions incorrectly expected
`statusCode` on `RestApiValidationError`, repeated ordinary DDL creation, used
`queryParams.filter` instead of `filters`, and omitted an existing defaulted
attribute from a full PUT. Corrected tests use the typed error class, repeat
creation only for canonical storage and follow the actual query/PUT contracts.
The initial `/tmp/library-schema-enrichment-before-{regular,canonical}.log`
and `baseline` logs therefore are not a clean count of public regressions.
The metadata initialization probes remain valid independent evidence for F1/F2.
The corrected alias probe is **12/13 pass** with the Fastify rejection in
`/tmp/library-schema-enrichment-http-evolution-before.log`. The layout guard
probe is **13/16 pass**, with three missing rejections in
`/tmp/library-schema-enrichment-layout-before.log`.

Focused checks pass **198/198 regular-mode invocation** and **204/204 canonical**
before four additional empty-layout/explicit-slot controls. These include the
registry/descriptor failure suites, field evolution, search behavior, custom IDs,
labels and storage mappings. Logs are
`/tmp/library-schema-enrichment-guarded-{regular,canonical}.log`. Final focused
schema/search/transport checks pass **106/106 regular** and **118/118 canonical**
(`/tmp/library-schema-enrichment-final-focused-{regular,canonical}.log`).
Targeted lint passes (`/tmp/library-schema-enrichment-lint.log`).

The first full gate passed **3325/3326 regular** (one existing skip), then found
two canonical assertions expecting the obsolete synthetic numeric ID slot
(`/tmp/library-schema-enrichment-full-gate.log`: **3332/3334 canonical**).
`conformance-search-authorization.test.js` now expects no undeclared ID
allocation; it retains the exact real-field slot positions, stored values and
reload checks. This is the only source change after the first gate/matrix.

The first native matrix terminates successfully with **290 checks in each
ordinary-mode invocation and 302 in each canonical-mode invocation**, across
SQLite/PostgreSQL/MySQL: **1,776 passes**, no failures/cancellations/skips
(`/tmp/library-schema-enrichment-native.log`). Canonical-specific registry and
field-evolution suites deliberately use canonical storage in both invocations.
The selected command was:

```sh
env PATH=/home/merc/.nvm/versions/node/v24.6.0/bin:$PATH LD_LIBRARY_PATH=/tmp/jra-database-binaries-dHBjur/root/usr/lib/x86_64-linux-gnu JSON_REST_API_POSTGRES_BIN=/tmp/jra-database-binaries-dHBjur/root/usr/lib/postgresql/16/bin JSON_REST_API_MYSQL_BIN=/tmp/jra-database-binaries-dHBjur/root/usr/sbin/mysqld node scripts/test-databases.js all tests/conformance-schema-enrichment.test.js tests/anyapi-field-evolution.test.js tests/anyapi-registry-failures.test.js tests/conformance-ids.test.js tests/conformance-fieldsets.test.js tests/conformance-labels.test.js
```

The final Node 24.6.0 `npm run verify` terminates successfully:
**3325/3326 regular** (one existing skip), **3334/3334 canonical**,
**364/364 Express 4 regular**, **366/366 Express 4 canonical**, lint and docs
(`/tmp/library-schema-enrichment-final-gate.log`).

The updated search-authorization suite also terminates successfully on all
six SQL/storage combinations: **95 each, 570 total**, with no failures,
cancellations or skips (`/tmp/library-schema-enrichment-search-native.log`).
It uses the native command above with only
`tests/conformance-search-authorization.test.js` as its test-file argument.
Together the targeted native matrices pass **2,346 checks**. Production source
is unchanged between the matrices. The runner removes both owned directories,
`/tmp/jra-db-vAzftM` and `/tmp/jra-db-t6yoGI`.

All **226 source hashes** in
`/tmp/library-schema-enrichment-tested-source.sha256` match after the jobs end.
The parked jskit-ai patch and non-root dependency entries remain unchanged.
Final evidence prose is rebuilt separately in
`/tmp/library-schema-enrichment-final-docs.log`.

This completes **A5-05**: request and connector schemas share authored validation
contracts, including after supported field additions; authorization/existence
checks remain imperative and pass the broader conformance suites. A5-02/03/04
and A5-06–12 remain open for dependency metadata, projections, configuration
lifetime, measured cache changes and consumer migration. The layout guard is
not a general concurrent schema-migration protocol. No final-review item is
closed by this batch.

**65/214 (30.4%) are complete; 149 remain.** All verification uses Node 24.
Consumer repositories, seeds and positioning remain paused.

## 2026-09-09: Resource compilation and cache inventory

The [resource metadata inventory](compiled-resources.md) traces authored and
compiled fields, search definitions, relationships, storage mappings, IDs,
getters/setters, computed/projection fields, request/connector schemas and
response normalization. It records cache owners, keys and refresh behavior,
distinguishing request-local state from persistent metadata. This completes
**A5-01**, not the implementation or final-review items.

An initialization probe reproduces two defects: search enrichment receives the
attribute map, and canonical rehydration overwrites an enriched field type while
retaining conflicting storage metadata. The inventory preserves a reproduction
recipe and regression acceptance criteria under A5-F1/A5-F2. Fastify contracts
captured before field addition, computed dependency timing, projection/label
refresh and shallow definition mutation remain source-identified risks pending
reproduction; they are not reported as verified public failures.

The shared `createSearchSchemaMergeApi` fixture now accepts pre-registration
hooks. Node 24.6.0 `tests/searchschema-merge.test.js` passes **5/5 in each storage
mode**, and lint of the fixture passes. Logs are
`/tmp/library-schema-inventory-fixture-{regular,canonical}.log` and
`/tmp/library-schema-inventory-lint.log`. The inventory documentation build
passes (`/tmp/library-schema-inventory-docs.log`).

Comparison with all 225 entries in the previous full-gate source snapshot shows
only the fixture changed; production source is unchanged. The parked migration
patch and non-root dependency entries retain their recorded hashes. The full
and native results below remain the latest production validation; they were not
rerun for this inventory. Final evidence prose is rebuilt separately in
`/tmp/library-schema-inventory-final-docs.log`.

**64/214 (29.9%) are complete; 150 remain.** A5-02–A5-12 remain open. Consumer
repositories, seeds and positioning remain paused; no Node 22/26 or consumer
verification was run.

## 2026-09-09: Stored linkage and schema metadata errors

The relationship corruption probes reproduced different successful responses:
ordinary storage skipped an undeclared polymorphic target, whereas canonical
storage could include the target if its resource was registered. The shared
`getPolymorphicLinkage` in the existing relationship-contract module now checks
the declared types and builds linkage for both storage modes. Its five callers
cover ordinary minimal reads, final response assembly, included-record metadata,
polymorphic include loading and canonical row conversion. It rejects invalid
stored types with a cause and `relationshipData` context. Intentional absence
and client validation retain their separate contracts.

Empty catches in `toJsonApiRecord` and `buildFieldSelection` now wrap schema
relationship-read failures with cause and resource/`relationshipMetadata`
context. A missing optional relationship map still behaves as an empty map.
Nonempty relationship work requires scope schema. Ordinary reverse polymorphic
reads require a valid `via`; canonical reverse reads require the corresponding
foreign-key slot or polymorphic columns. Missing metadata no longer becomes an
empty relationship result.

The unhandled nested-relationship branch is retained intentionally. A validated
polymorphic union can request a path present on writers but absent on books.
`include-traversal.test.js` verifies that case and rejection of a path absent
from every declared target type, including when there are no stored rows.
This branch is not equivalent to ignoring a thrown failure.

The new `conformance-relationship-metadata.test.js` has **34 shared cases**:
12 primary/nested read cases, eight reverse-metadata cases, four empty/sparse/
client-validation controls, four owned/borrowed write-response cases, two
public schema-read traces and four real HTTP GET/PATCH cases. Each of the eight
primary GET/query/format/include cases tries registered-but-undeclared,
unregistered and empty-string stored types. The schema traces inject failure
at every observed relationship read after warming the request contract. Ten
additional helper cases cover typed/frozen/null schema failures and required
schema versus empty work. The Express 4 commands include the two Express cases.

Initial draft corrections are kept explicit: scope customization was replaced
with `api.customize`, and the correct injection hook is `afterDataCallPatch`.
The write probe now asserts it ran exactly once. The plain empty relationship
control follows the documented omitted-field convention. Sparse success uses
valid linkage, since preliminary reads can inspect linkage even if output
excludes it. Canonical reverse-metadata tests alter actual stored configuration
JSON and invalidate the affected descriptor; modifying a returned clone cannot
inject a failure. Tests verify the stored mutation and restore it for recovery.

The initial logs `/tmp/library-relationship-metadata-before-regular.log` and
`/tmp/library-relationship-metadata-before-canonical.log` each record 3/24
passes, but include those draft issues; they are not a clean 21-defect count.
Sixteen read/HTTP cases reproduce missing rejections. The schema-trace logs
`/tmp/library-relationship-schema-before-{regular,canonical}.log` reproduce
swallowed relationship-read errors; the initial canonical reverse tests in
those logs still modified descriptor clones and do not prove injection.
Final verification below uses the corrected tests.

After targeted lint, focused Node 24.6.0 checks pass **283/283 per mode**:

```sh
env PATH=/home/merc/.nvm/versions/node/v24.6.0/bin:$PATH node --test tests/conformance-relationship-metadata.test.js tests/include-error-handling.test.js tests/include-traversal.test.js tests/storage-mapping.test.js tests/conformance-ids.test.js tests/conformance-fieldsets.test.js
env PATH=/home/merc/.nvm/versions/node/v24.6.0/bin:$PATH JSON_REST_API_STORAGE=anyapi node --test tests/conformance-relationship-metadata.test.js tests/include-error-handling.test.js tests/include-traversal.test.js tests/storage-mapping.test.js tests/conformance-ids.test.js tests/conformance-fieldsets.test.js
```

Logs are `/tmp/library-relationship-metadata-final-focused-regular.log` and
`/tmp/library-relationship-metadata-final-focused-canonical.log`; lint is
`/tmp/library-relationship-metadata-lint.log`.

`npm run verify` terminates successfully on Node 24.6.0: **3317/3318 regular
SQLite** (one existing skip), **3314/3314 canonical SQLite**, **363/363 Express 4
per mode**, lint and docs
(`/tmp/library-relationship-metadata-full-gate.log`). The native command is:

```sh
env PATH=/home/merc/.nvm/versions/node/v24.6.0/bin:$PATH LD_LIBRARY_PATH=/tmp/jra-database-binaries-dHBjur/root/usr/lib/x86_64-linux-gnu JSON_REST_API_POSTGRES_BIN=/tmp/jra-database-binaries-dHBjur/root/usr/lib/postgresql/16/bin JSON_REST_API_MYSQL_BIN=/tmp/jra-database-binaries-dHBjur/root/usr/sbin/mysqld node scripts/test-databases.js all tests/conformance-relationship-metadata.test.js tests/conformance-fieldsets.test.js tests/conformance-ids.test.js tests/conformance-include-failures.test.js tests/conformance-relationship-writes.test.js
```

It terminates successfully with **346 per SQL/storage combination, 2,076 total**,
no failures/cancellations/skips (`/tmp/library-relationship-metadata-native.log`).
The runner removes `/tmp/jra-db-qKnNQP`. All **225 hashes** in
`/tmp/library-relationship-metadata-tested-source.sha256` match after both jobs
end. The parked jskit-ai patch and non-root lockfile dependency entries are
unchanged. Final evidence/migration docs are rebuilt in
`/tmp/library-relationship-metadata-final-docs.log`.

This completes **B4-03**. Arbitrary hook dispatch, wider transaction/cleanup
semantics, consumer migration and all final-review items remain open.
**63/214 (29.4%) are complete; 151 remain.** Consumers, seeds and positioning
remain paused; no Node 22/26 or consumer verification was run.

## 2026-09-09: Field callback errors and pivot target reads

The selected callback policy is error propagation without an added option.
`applyFieldSetters` and `enrich-attributes.js` use the existing
`wrapUnexpectedError`: typed errors retain identity; unexpected failures retain
cause and field/resource/phase context. A generic setter error now produces 500
instead of being converted to 422 without a cause. Intentional input rejection
uses `RestApiValidationError`. Getters no longer keep the current value after a
failure; computed fields no longer substitute null. Both ordinary pivot target
validation catches were removed, preserving the related GET's classification
and cause as canonical storage already does.

The new shared suite `tests/conformance-field-callback-failures.test.js`
initially passed **76/220**, failing **144**
(`/tmp/library-field-callbacks-before.log`). Earlier test drafts were corrected
before that baseline: database snapshots must run before borrowing the sole
SQLite connection, and PUT replacements must include populated belongsTo and
polymorphic relationships. The stalled draft's owned processes were stopped;
no runtime connection or PUT policy was changed to accommodate those drafts.

The final suite covers 48 primary GET/query failures, 48 failures across all
six include kinds, four nested cases, four unselected callback cases, eight
minimal/none response cases, 48 resource writes, 36 pivot-target failures and
24 real Express/Fastify HTTP requests. It checks synchronous/asynchronous,
typed/frozen/non-Error failures, both formats, owned/borrowed transactions,
actual record/pivot state, no successful partial response and recovery.
Express 4 commands include the 12 new Express cases. Native discovery already
includes the new conformance file.

The three old getter/computed fallback tests now assert rejection and owned
rollback, seed using minimal output and verify a subsequent read rejects.
Their resource declarations moved into the shared fixtures. The setter
rollback test now asserts the actual collection envelope's `data.length` and
retained cause/context. Explicit callback fallbacks, such as the existing
JSON getter returning an empty object, still work.

After targeted lint, focused verification passes **270/270 per mode**:

```sh
env PATH=/home/merc/.nvm/versions/node/v24.6.0/bin:$PATH node --test tests/conformance-field-callback-failures.test.js tests/field-getters.test.js tests/field-setters.test.js tests/computed-fields.test.js
env PATH=/home/merc/.nvm/versions/node/v24.6.0/bin:$PATH JSON_REST_API_STORAGE=anyapi node --test tests/conformance-field-callback-failures.test.js tests/field-getters.test.js tests/field-setters.test.js tests/computed-fields.test.js
```

Logs are `/tmp/library-field-callbacks-focused-regular.log` and
`/tmp/library-field-callbacks-focused-canonical.log`; targeted lint is
`/tmp/library-field-callbacks-lint.log`.

`npm run verify` on **Node 24.6.0** terminates successfully with **3273/3274
regular SQLite** (one existing skip), **3270/3270 canonical SQLite**, **361/361
Express 4 per mode**, lint and docs
(`/tmp/library-field-callbacks-full-gate.log`). Native verification uses:

```sh
env PATH=/home/merc/.nvm/versions/node/v24.6.0/bin:$PATH LD_LIBRARY_PATH=/tmp/jra-database-binaries-dHBjur/root/usr/lib/x86_64-linux-gnu JSON_REST_API_POSTGRES_BIN=/tmp/jra-database-binaries-dHBjur/root/usr/lib/postgresql/16/bin JSON_REST_API_MYSQL_BIN=/tmp/jra-database-binaries-dHBjur/root/usr/sbin/mysqld node scripts/test-databases.js all tests/conformance-field-callback-failures.test.js tests/conformance-include-failures.test.js tests/conformance-relationship-writes.test.js tests/conformance-write-failures.test.js
```

It terminates successfully with **418 checks per SQL/storage combination,
2,508 total**, no failures/cancellations/skips
(`/tmp/library-field-callbacks-native.log`). Databases are SQLite 3.49.2,
PostgreSQL 16.15 and MySQL 8.0.46. The runner removed `/tmp/jra-db-eiQrOT`.
All **224 source hashes** in
`/tmp/library-field-callbacks-tested-source.sha256` match after both jobs end.
The parked jskit-ai patch hash and non-root lockfile dependency entries remain
unchanged. Final documentation rebuild is recorded separately in
`/tmp/library-field-callbacks-final-docs.log`.

The [B4 inventory](write-lifecycle.md#b4-callbackinclude-policy-inventory)
records remaining metadata guards and the installed hook dispatcher defect.
This completes **B4-01, B4-04, B4-06 and B4-08**; it does not close consumer
migration, all error boundaries, transaction side effects or Part C review.
**62/214 (29.0%) are complete; 152 remain.** Consumers, seeds and positioning
remain paused. No Node 22/26 or consumer verification was run.

## 2026-09-09: Descriptor failures and post-write record refresh

The canonical descriptor regression suite initially passed **1/40**, failing
**39** (`/tmp/library-descriptor-failures-before.log`). A first in-memory fixture
attempt was stopped because bypassing the descriptor cache during a transaction
needed another connection; the recorded baseline uses the existing isolated
SQLite file/WAL fixture. No runtime connection policy was changed for that
test-fixture issue.

Registry reads now use the existing error wrapper to retain unexpected causes
with tenant/resource context and phase `descriptor`; typed errors retain their
identity. Four broad inverse/reverse/polymorphic catches were removed. The
belongsTo include path uses the existing required-descriptor helper, matching
the other relationship paths. Direct absent-descriptor lookups still return
null; a required missing relationship descriptor rejects. Recovery after a
real metadata removal/restoration is tested.

The first combined run after those changes passed **177/189**, with 12 failing
write cases (`/tmp/library-descriptor-failures-focused.log`). A diagnostic trace
proved the failure was injected but swallowed by `handleRecordReturnAfterWrite`
(`/tmp/library-descriptor-failures-write-probe.log`). Its generic post-write
minimal-record refresh error was logged and ignored. That shared catch now
wraps the failure with its cause, resource and `postWriteRead` phase and rejects
before finish/owned commit; it no longer continues with stale state.

Final new coverage consists of:

- **65 canonical descriptor cases**: 36 traced programmatic cases inject a
  failure at every observed descriptor read, totaling 416 injection points;
  four direct registry rejections bring that to **420**. Reads cover every
  include kind, nested paths, collections, related and linkage methods. Writes
  cover creation/update and relationship replacement/removal, both formats and
  owned/borrowed transactions. Another case distinguishes absent/required
  descriptors, and 24 use real Express/Fastify HTTP listeners. The 12 Express
  cases also run through Express 4 in the connector commands.
- **48 shared post-write refresh cases**: POST, PUT-create/update and PATCH;
  all three return modes; both formats and transaction ownership modes; typed,
  frozen, null and undefined failures; records/pivots, no finish/commit hooks
  after failure, borrowed local state, rollback and recovery. The initial
  draft's snapshot used `id` instead of the fixture's custom `items_key`, and
  PUT-update omitted populated `active`/`score`; those test inputs were corrected
  before recording the passing shared results.

Final focused verification passes **162/162**
(`/tmp/library-descriptor-refresh-final-focused.log`). The shared refresh suite
also passes **48/48** independently in each storage mode
(`/tmp/library-post-write-read-failures-regular.log` and
`/tmp/library-post-write-read-failures-canonical.log`). Lint passes before the
full matrix (`/tmp/library-descriptor-refresh-lint.log`).

On **Node 24.6.0**, `npm run verify` completes successfully:
**3053/3054 regular SQLite** (one existing skip), **3050/3050 canonical SQLite**,
**349/349 Express 4 per mode**, lint and docs
(`/tmp/library-descriptor-refresh-full-gate.log`). The native matrix passes
**672 per SQL/storage combination, 4,032 total**, with no failures, cancellations
or skips (`/tmp/library-descriptor-refresh-native.log`). Its selected files were
`anyapi-descriptor-failures`, `conformance-post-write-read-failures`,
`anyapi-registry-failures`, `conformance-include-failures`,
`conformance-lifecycle` and `conformance-relationship-writes`, all in `tests/`
with `.test.js` suffixes. Registry/descriptor-specific suites always use
canonical storage; their regular invocation is repeated canonical coverage.

The 223 source hashes in
`/tmp/library-descriptor-refresh-tested-source.sha256` match after both jobs
terminated. The native runner removed `/tmp/jra-db-UAlpsL`. Final evidence and
migration docs are rebuilt in `/tmp/library-descriptor-refresh-final-docs.log`.
No Node 22/26 or consumer verification was run.

The [boundary inventory](write-lifecycle.md#remaining-error-boundaries) retains
getter/computed fallbacks, generic setter causes/classification, ordinary pivot
existence-check wrappers, arbitrary hook-dispatch failures, managed side effects
and public outcome metadata as unfinished work. This batch does not complete
the library-wide error policy or any Part C final review item. **58/214 (27.1%)
are complete; 156 remain.** Consumers, seeds and positioning remain paused;
the parked jskit-ai patch is unchanged.

## 2026-09-09: Registry rollback failures and descriptor cache isolation

The initial real-metadata registry matrix passed **21/48** and failed **27**
(`/tmp/library-registry-failures-before.log`). Both new/existing registration
and field allocation could replace the original error when rollback rejected.
Completed transactions were rolled back again; when the commit call rejected
after actual commit, existing cached descriptors could remain stale.

Both owned-write catches now reuse `rollbackAfterError`. A small registry-local
handler invalidates the affected descriptor and passes original/secondary
diagnostics with tenant/resource context to guarded error logging. Typed and
frozen errors, null and undefined retain their original identity/value. No
error object mutation or new outcome/compatibility API is introduced. Borrowed
transactions still belong to their caller and do not publish uncommitted
descriptors into the global cache.

An additional real-registry probe reproduced a collision between
`["field_evolution::extra", "items"]` and
`["field_evolution", "extra::items"]`: a cached read returned the other tenant's
descriptor (`/tmp/library-registry-cache-key-before.log`, **0/1**). The existing
key helper now encodes the pair unambiguously. Its regression verifies isolated
reads, updates and invalidation. This changes only an in-memory cache key and
requires no stored-data migration.

The final registry suite contains **49 cases**. It inspects real resource,
field and relationship metadata, seeded application rows, cache state,
transaction completion and successful recovery after confirmed rollback. It
also covers synchronous/asynchronous logger failure and caller-owned success
followed by commit/rollback. The default native runner includes this suite.
Registry-specific suites always use canonical storage, including when the
outer run selects regular storage; those repetitions are not ordinary table
registry coverage.

All verification used **Node 24.6.0**:

- Full test stages passed **2940/2941 regular SQLite** (one existing skip),
  **2937/2937 canonical SQLite**, and **337/337 Express 4 per mode**. The
  `npm run verify` command then stopped at six formatting lint errors in the
  new test file (`/tmp/library-registry-failures-full-gate.log`).
- The native matrix passed **1,384 checks**: 230 in each SQLite run and 231
  in each PostgreSQL/MySQL run, with no failures, cancellations or skips
  (`/tmp/library-registry-failures-native.log`). The selected files were
  `anyapi-registry-failures`, `anyapi-field-evolution`,
  `anyapi-temporal-migration`, `conformance-transactions`,
  `conformance-write-failures`, `conformance-file-failures` and
  `conformance-bulk-failures`, all under `tests/` with `.test.js` suffixes.
- After the jobs terminated, only whitespace in the new test file changed to
  satisfy lint. Final lint passes
  (`/tmp/library-registry-failures-final-lint.log`), and the focused registry,
  field-evolution, error-context, write-cleanup and runner checks pass
  **98/98** (`/tmp/library-registry-failures-final-focused.log`). Runtime code
  did not change after the full/native tests, so those matrices were not
  repeated for formatting. The 221 source hashes are recorded before/after in
  `/tmp/library-registry-failures-tested-source.sha256` and
  `/tmp/library-registry-failures-final-source.sha256`.

The native runner removed its owned directory `/tmp/jra-db-7hwGi7`. Final
documentation is rebuilt separately in
`/tmp/library-registry-failures-final-docs.log`; the migration guide explains
diagnostics, cache invalidation, borrowed ownership and uncertain outcomes.

Review of descriptor consumers found four broader catches in the canonical
plugin. A one-shot target-descriptor failure during public GET resolves
successfully and can omit relationship linkage; a polymorphic GET also
swallowed the error (`/tmp/library-registry-include-read-probe.log`). These
read/inverse-link catches remain unfixed and are the next A7/B4 boundary.
The registry tests replace the logger method with an awaitable implementation;
they do not fix the installed hook dispatcher's failure to forward arbitrary
async log-sink returns or its null-hook rejection bug.

**58/214 (27.1%) are complete; 156 remain.** A5-08, A7-05/A7-06 and the final
review items remain open. Consumer repositories, seeds and positioning are
unchanged; the parked migration patch retains its recorded checksum.

## 2026-09-09: Query copy errors, file cleanup and completed transactions

The query-copy probe now has **24 shared cases** covering collection/related
reads, both representations, borrowed/no transactions, recovery and successful/
throwing/rejecting error logging. The baseline passed **16/24** with eight
failures plus unhandled logging rejections (`/tmp/library-query-copy-before.log`).
The query method now propagates its existing copy error directly; its redundant
catch/log was removed.

Filesystem-backed cases reproduced discarded temporary-cleanup diagnostics,
warning failures stopping later cleanup, lost failed-deletion entries and
unexpected storage errors mislabeled as validation errors without their causes.
Context reuse could also delete files belonging to an earlier committed write.
The corrected initial file matrix passed **2/26** before the changes
(`/tmp/library-file-cleanup-before.log`). Tests create, copy, inspect and remove
actual files in suite-owned temporary directories.

File cleanup now retains `{ phase, field, error }` diagnostics, continues with
later files and keeps failed deletion entries. Warning failures have a separate
`logging` entry identifying their cleanup phase. The rollback helper retains
earlier diagnostics. Upload tracking identifies its creating transaction;
cleanup selects that transaction, and owned commit releases its entries. Reuse
is tested after both operation-owned and caller-owned commits. Detector/parser/
upload callbacks retain causes through the existing error wrapper; typed errors
keep their identity. The existing generic detector test now asserts the
documented cause relationship. Real HTTP multipart tests prove unexpected
storage failure returns 500, typed access denial retains 403, and MIME input
failure retains 422.

An intermediate full gate and native matrix passed: **2881/2882 regular**
(one existing skip), **2878/2878 canonical**, **337/337 Express 4 per mode**,
lint/docs and **3,084 native checks** (`/tmp/library-query-file-failures-full-gate.log`,
`/tmp/library-query-file-failures-native.log`). A subsequent independent probe
found that a commit wrapper rejecting after database completion could run
rollback hooks and delete the committed upload while retaining its database row
(`/tmp/library-completed-write-cleanup-probe.log`). All ten added resource,
relationship and file regressions failed before the completion guard
(`/tmp/library-completed-write-cleanup-before.log`).

The shared rollback helper now checks driver completion before rollback. Bulk's
existing completion guard moved into the same helper. Completed transactions
do not run rollback hooks. Completion alone does not identify every committed,
rolled-back or uncertain outcome; no outcome API is claimed. Final coverage has
**56 shared resource/relationship failure cases**, **40 shared file/HTTP cases**
and 24 query-copy cases. The focused combined run passes **165/165**
(`/tmp/library-query-file-failures-completed-focused.log`).

Final **Node 24.6.0** `npm run verify` passes **2891/2892 regular SQLite**
(one existing skip), **2888/2888 canonical SQLite**, **337/337 Express 4 per
mode**, lint and docs (`/tmp/library-query-file-failures-completed-full-gate.log`).
The native command `node scripts/test-databases.js all` with
`tests/conformance-query-failures.test.js`, `tests/conformance-file-failures.test.js`,
`tests/conformance-write-failures.test.js`, `tests/conformance-bulk-failures.test.js`,
`tests/conformance-transaction-context.test.js` and `tests/conformance-lifecycle.test.js`
passes **524 per SQL/storage combination: 3,144 total**, zero failures,
cancellations or skips (`/tmp/library-query-file-failures-completed-native.log`).
The 220 selected source hashes in
`/tmp/library-query-file-failures-completed-source.sha256` match after both jobs
completed. Only Node 24 was tested; no remote CI or consumer run is claimed.

The review found two remaining direct rollback catches in AnyAPI's registry.
A separate real-registry allocation probe confirms that rejected rollback
replaces the existing-field error (`/tmp/library-registry-rollback-probe.log`).
That remains unfixed, as does the reproduced hook-dispatcher null rejection.
The [boundary inventory](write-lifecycle.md#remaining-error-boundaries) retains
managed/borrowed/atomic-bulk side effects, previous-file replacement/deletion,
getter/computed behavior and outcome metadata as unfinished work.

The migration/file guides document these changes. **A7-05/A7-06/A7-09 remain
open; 58/214 (27.1%) are complete and 156 remain.** Positioning and consumer work
remain paused. Final evidence docs are rebuilt in
`/tmp/library-query-file-failures-final-docs.log`; the parked migration patch is
unchanged.

## 2026-09-09: Include/projection causes and redundant error logging

The wrapper probe from the prior batch now has executable regressions. The
shared include/projection fixture exercises belongsTo, hasMany, hasOne,
many-to-many, polymorphic and reverse-polymorphic includes through GET/query
and full PATCH responses in both representations. An initial test supplied
array fieldsets, which the API rejects; this was corrected to the documented
comma-separated string before recording the regression baseline. The corrected
run passed **38/106** and failed **68** (`/tmp/library-include-errors-before.log`):
null/undefined projection rejections lost their causes, and generic wrapper
messages mishandled non-Error values.

A separate 54-case lower-level include matrix injects database-boundary
failures and successful, throwing or rejecting error loggers. The baseline
passed **30/54** with **24 assertion failures**, plus unhandled logging promise
rejections (`/tmp/library-include-logging-before.log`). These cases deliberately
test the loader boundary with a failing database function; they are not claimed
as real database queries. The public fixture cases use the actual SQL drivers.

`wrapUnexpectedError` now retains every tested original cause, including null,
undefined, primitives and an unprintable object. Typed API errors still return
by identity; frozen generic errors remain unchanged as causes. The shared
query-field runtime builder wraps callback/expression failures with resource,
field and projection-phase context before they cross outer dispatch wrappers.
It keeps the existing handling of synchronous Knex expressions and awaited
callback promises. Include catches retain contextual cause chains and no longer
log the same error repeatedly before rethrowing. A redundant catch was removed;
no new error framework, compatibility mode or logger abstraction was added.

Four additional nested cases allow the primary projection to succeed before
the same field fails deeper in the include graph. Final focused coverage passes
**164/164**: ten wrapper cases, 54 helper/logging cases and **100 shared public
cases** (`/tmp/library-include-errors-final-focused.log`). Public cases verify
typed identity, original causes, successful recovery reads, nested paths and
pre-commit write rejection. Owned PATCH changes roll back; borrowed PATCH
changes remain visible within the owner's transaction until its explicit
rollback. The fixture's optional projection callback reuses existing resources.

Final **Node 24.6.0** `npm run verify` passes **2819/2820 regular SQLite**
(one existing skip), **2816/2816 canonical SQLite**, **337/337 Express 4 per
mode**, lint and docs (`/tmp/library-include-errors-full-gate.log`). The native
command `node scripts/test-databases.js all` with
`tests/conformance-include-failures.test.js`, `tests/conformance-include-permissions.test.js`,
`tests/conformance-fieldsets.test.js`, `tests/conformance-queries.test.js` and
`tests/conformance-write-failures.test.js` passes **2,556 checks**: 427 regular
and 425 canonical on each of SQLite, PostgreSQL and MySQL, no failures,
cancellations or skips (`/tmp/library-include-errors-native.log`). The existing
query suite has two additional regular-storage cases. All 218 selected source
hashes in `/tmp/library-include-errors-tested-source.sha256` match after both
jobs completed. Only Node 24 was tested; no remote CI or consumer run is claimed.

Two independent public-path probes establish the next work without modifying
the tested runtime. A query helper delegates to real storage, then supplies an
uncopyable attribute: the ordinary `DataCloneError` is replaced if its error
logger throws (`/tmp/library-query-clone-logging-probe.log`). A GET hook throwing
null produces a property-access `TypeError` without cause in installed
`hooked-api` 1.0.24 (`/tmp/library-hook-null-probe.log`). Both remain unfixed.
The [failure-boundary review](write-lifecycle.md#remaining-error-boundaries)
records those results separately from source-only file-cleanup candidates and
the selected B4 getter/computed work.

The projection and migration guides document causes and operation failure
behavior. **A7-05/A7-06 remain open; the checklist stays 58/214 (27.1%), with
156 remaining.** Positioning and consumer work stay paused. Final evidence docs
are rebuilt in `/tmp/library-include-errors-final-docs.log`; the parked migration
patch remains unchanged.

## 2026-09-09: Atomic bulk rollback preserves the original error

The next A7-05 batch reproduced error masking in all three bulk methods. Each
atomic child catch rolled back before rethrowing, while the outer catch also
rolled back unfinished transactions. If rollback rejected, POST/PATCH/DELETE
each attempted it twice and returned the cleanup error instead of the original
child error. Failed cleanup also replaced commit errors and PATCH's malformed
operation error. The 20 new shared cases all failed before the fix, including
new context-diagnostic assertions (`/tmp/library-bulk-cleanup-before.log`). An
initial test read validation fields from the wrong property; it was corrected
to `error.details.fields` before that recorded baseline.

Only the outer bulk catch now rolls back. The original-error and rollback
diagnostic sequence was moved from the resource handler into the existing
`lib/error-context.js` module as `rollbackAfterError`, used by both callers.
Each caller still explicitly selects its rollback-eligible transaction; the
resource handler retains its own rollback hooks and awaited logging. Bulk adds
no completion hook or transaction mode. Its supplied context now receives the
original `error` and ordered `cleanupErrors`, and clears them on the next call,
including validation failure before a transaction starts.

The 20 bulk cases cover POST/PATCH/DELETE child and commit failures, a commit
that actually completes before its wrapper rejects, and malformed PATCH after
a successful prefix. Rollback may resolve or reject. Assertions check original
error identity/classification, one rollback attempt for unfinished transactions,
no rollback after actual completion, original records and many-to-many linkage
after cleanup, committed values, and successful context reuse. When injected
rollback rejects, the test explicitly cleans up the still-active transaction;
it does not claim that the library's rejected rollback restored the data.

The bulk cases and prior resource/relationship/helper regressions pass **86/86**
on SQLite (`/tmp/library-bulk-cleanup-fixed.log`). Final Node 24.6.0
`npm run verify` passes **2655/2656 regular SQLite** (one existing skip),
**2652/2652 canonical SQLite**, **337/337 Express 4 per mode**, lint and docs
(`/tmp/library-bulk-cleanup-full-gate.log`).

The native command `node scripts/test-databases.js all` with
`tests/conformance-bulk-failures.test.js`, `tests/conformance-bulk-authorization.test.js`,
`tests/conformance-write-failures.test.js`, `tests/conformance-lifecycle.test.js`
and `tests/conformance-transaction-context.test.js` passes **508 in each of six
SQL/storage combinations: 3,048 total**, with no failures, cancellations or
skips (`/tmp/library-bulk-cleanup-native.log`). The 215 selected runtime/test/
script/package/CI source hashes in `/tmp/library-bulk-cleanup-tested-source.sha256`
match after both jobs completed. Only Node 24 was tested; no remote CI or
consumer run is claimed.

A separate direct probe of the existing `wrapUnexpectedError` found that null
and undefined throws become new property-access errors, losing their original
causes; a thrown string produces an unhelpful `undefined` message
(`/tmp/library-error-context-probe.log`). This remains unfixed. The
[failure-boundary review](write-lifecycle.md#remaining-error-boundaries)
distinguishes that reproduced defect from source-level candidates in includes,
query logging, file cleanup and the installed hook dispatcher. Getter/computed
fallback behavior remains the separately selected B4 work.

**A7-05/A7-06 remain open; 58/214 (27.1%) are complete and 156 remain.**
The migration and bulk guides document the scoped diagnostic change. Positioning
and consumer work remain paused. The parked migration patch is unchanged.
Final evidence docs are rebuilt in `/tmp/library-bulk-cleanup-final-docs.log`.

## 2026-09-09: Node 24 test policy and original write errors

The maintainer revised runtime support to **Node 24+**, with **Node 24 only**
for development and CI verification. Package/lockfile engines now require
`>=24.0.0`; `.nvmrc` and both CI matrices select 24.6.0. This reduces the
configured runtime matrix from eight jobs to four while retaining the library,
PostgreSQL, MySQL and Redis jobs and both storage modes. Runtime/setup guides
and the API migration guide reflect this policy. Earlier Node 22/26 results
below remain historical evidence; neither runtime was tested in this batch.
The root installation was rebuilt with Node 24 using `npm ci`
(`/tmp/library-node24-policy-install.log`). All non-root locked dependency
entries retain their recorded SHA-256; actionlint passes the revised workflow.

The shared write error handler previously allowed rollback, rollback-hook and
logging failures to replace the original rejection. It also discarded an async
logger's return value, allowing rejected logging promises to escape. All 18 new
helper regressions failed before the fix (`/tmp/library-write-error-before.log`)
and now pass (`/tmp/library-write-error-unit.log`).

The existing handler retains the original rejection and records secondary
failures in `context.cleanupErrors`, an ordered array of `{ phase, error }`
entries. `context.error` holds the original failure. A new write clears these
diagnostics. Rollback hooks run only after rollback resolves; borrowed and
acknowledged-commit paths do not roll back. The existing enhanced logger now
returns its result so the handler can await it. No new transaction framework
or error wrapper was introduced.

`conformance-write-failures` adds **48 cases per database/storage combination**:
POST, PUT-create/update, PATCH, DELETE and the three relationship mutations,
with owned/borrowed transactions and injected rollback/afterRollback failures.
Tests check original error identity, cleanup ordering, actual stored values and
linkage after cleanup, transaction ownership and cleared diagnostics when the
same context performs a successful operation. Helper tests additionally cover
frozen errors, non-Error rejections and rejected async logging. Those helper
results do not establish non-Error preservation through every outer extension.

Final **Node 24.6.0** `npm run verify` completed successfully
(`/tmp/library-node24-write-cleanup-full-gate.log`):

| Job | Result |
| --- | --- |
| Full regular SQLite | 2635/2636 passed; one existing canonical-fixture-only skip |
| Full canonical SQLite | 2632/2632 passed |
| Express 4 regular/canonical | 337/337 in each mode |
| Lint and documentation build | Passed |

The native command `node scripts/test-databases.js all` with
`tests/conformance-write-failures.test.js`, `tests/conformance-lifecycle.test.js`,
`tests/conformance-transaction-context.test.js` and
`tests/conformance-relationship-writes.test.js` passes **474 in each of six
SQLite/PostgreSQL/MySQL and regular/canonical combinations: 2,844 total**,
zero failures, cancellations or skips (`/tmp/library-write-cleanup-native.log`).
The 214 selected source hashes in
`/tmp/library-write-cleanup-tested-source.sha256` still match after verification;
the runner directory `/tmp/jra-db-Fl8j6o` was removed. No remote CI run is claimed.

**A7-05 remains open** for bulk cleanup and the other failure boundaries.
Transaction outcome metadata and full typed/non-Error propagation also remain
unfinished. The verified checklist remains **58/214 (27.1%)**, A51/138, B5/48,
M2/14, C0/14; **156 remain**. Positioning and consumer work stay paused, and the
parked migration patch checksum is unchanged. Final evidence documentation is
rebuilt in `/tmp/library-write-cleanup-final-docs.log`.

## 2026-09-09: Write response completion and reused-context IDs

This batch continues A4-04/A4-13 and reviews A4-09/A4-11/A4-17. Consumer
repositories and positioning remain paused.

Three defects were reproduced and fixed through existing helpers:

- **Finish-hook fieldsets:** 24 new primary/included cases failed before passing
  the requested fields to the final write normalizer. The existing field filter
  now handles one plain resource, while the existing normalizer walks related
  plain records. No second traversal helper was added. The first expanded
  fieldset/lifecycle matrix passed 359 in all six SQL/storage combinations,
  **2,154 total** (`/tmp/library-write-response-native.log`).
- **After-commit response aliases:** 12 fieldset and 12 temporal regressions
  failed because `afterCommit` could rewrite the returned object after final
  normalization. The existing response helper now returns a `structuredClone`
  before commit. Finish hooks remain the last response mutation point; none
  returns undefined without a copy. Minimal identifiers, included records,
  invalid/native dates and copy failures before commit have explicit tests.
- **Stale hook-visible IDs:** reusing a GET context for a generated POST left its
  old ID visible in early hooks (four failures). Extending the cases after the
  initial POST-only reset exposed twelve equivalent PUT/PATCH failures. The
  reset now lives in `setupCommonRequest`, alongside its existing state resets.
  Validated/generated IDs are assigned at their original method boundaries.

Reproduction logs are `/tmp/library-write-fieldsets-before.log`,
`/tmp/library-response-completion-before.log` (68 passing selected lifecycle
cases and 24 response failures), `/tmp/library-generated-reuse-before.log`
(0/4), and `/tmp/library-write-id-reuse-before.log` (8/20). The initial invalid
Date assertion exposed a Node 22 TAP reporter failure; the test now checks the
value's type first so the complete regression run reports ordinary assertions.

The lifecycle suite now has **368 cases per mode**, up from 271: generated POST
success/failure traces, 20 reused-context cases, ten minimal-response isolation
cases and four copy-failure ownership cases. Generated baseline rows use the
shared fixture's new `generatedId` seed option, so the tests do not assume that
explicit IDs advance PostgreSQL sequences or that rollback rewinds them.
Fieldsets grow from 64 to 100 cases; the temporal suite gains 36 write-boundary
cases. Native temporal capability cases still vary by driver/storage mode.

An intermediate five-file native matrix passed **3,995 checks** before the
shared PUT/PATCH ID reset (`/tmp/library-response-completion-native.log`).
The final runtime source is frozen in
`/tmp/library-response-completion-tested-source.sha256`; all 211 selected
runtime/test/script/package/CI files matched the clean Node 24 installation.
Final full gates pass on **Node 22.16.0 and 24.6.0**: **2569/2570 regular SQLite**
(one existing canonical-fixture-only skip), **2566/2566 canonical SQLite**,
**337/337 Express 4 per mode**, lint and docs. Native checks pass **4,427 per
runtime** with zero failures, cancellations or skips:

| Runtime | Full gate | Native checks |
| --- | --- | --- |
| Node 22.16.0 | `/tmp/library-response-completion-full-gate.log` | `/tmp/library-response-completion-final-native.log` (4,091) plus `/tmp/library-response-completion-related-native.log` (336) |
| Node 24.6.0 | `/tmp/library-node24-response-completion-full-gate.log` | `/tmp/library-node24-response-completion-final-native.log` (4,427) |

Commands are `npm run verify` and `node scripts/test-databases.js all` with
`tests/conformance-fieldsets.test.js`, `conformance-lifecycle.test.js`,
`conformance-temporal.test.js`, `conformance-formats.test.js`,
`conformance-transaction-context.test.js`, `conformance-values.test.js` and
`conformance-relationship-writes.test.js` (all paths under `tests/`). Node 22
ran the last two files as a separate matrix to verify partial/replacement and
relationship behavior after the method review. Combined per-combination counts
are 737/738 on SQLite and 737/739 on PostgreSQL/MySQL (regular/canonical).
The native temporal capability cases account for the varying totals.

Full-gate regular/canonical/Express-4-regular/Express-4-canonical durations are
108.398/149.893/31.699/22.930 seconds on Node 22 and
122.632/134.287/18.495/17.669 seconds on Node 24. Docs took 4.532 and 4.359
seconds. Concurrent test processes make these unsuitable performance comparisons.
No remote CI run is claimed.

The migration guide and hook reference describe the new response snapshot and
ID timing. The [lifecycle review](write-lifecycle.md) records why DELETE and
relationship methods keep their existing separate sequences. **A4-09, A4-11 and
A4-17 are complete:** PATCH uses the selected helpers while retaining its partial
validation/authorization/relationship decisions; DELETE/relationship reuse was
reviewed; the resulting methods were reviewed from top to bottom without adding
flags or another orchestration layer. The verified total is **58/214 (27.1%)**,
A51/138, B5/48, M2/14, C0/14; **156 remain**. A4-13 stays open for its broader
normalization and consumer acceptance, as do relationship/bulk traces, secondary
cleanup failures and the selected transaction/outcome API.

After every test job completed, all 211 source hashes still matched both tested
copies. The private Node 24 installation and path record were removed, and all
five disposable runner directories from this response batch were confirmed
absent. The parked migration SHA-256 remains
`81c454022208ba2c1bc8d2a893a4e3eb9d7d5c8b09d8e86a4bf435ea9b6e2d3e`.
Final documentation is rebuilt separately in
`/tmp/library-response-completion-final-docs.log`; `git diff --check` passes.

## 2026-09-09: core resource lifecycle traces and setter orchestration

Positioning remains paused at the maintainer's request. The four positioning
fixtures now select the requested driver; their initial regular PostgreSQL and
MySQL runs each pass 55/60, with five duplicate-key concurrency failures retained
as open evidence. No positioning production change or new default runner entry
was made. Read-only jskit-ai inspection at `701635463` found neither positioning
usage nor use of this library's SocketIOPlugin; its realtime package imports
Socket.IO directly. Consumer repositories and seeds remain unchanged.

The A4 work now targets the core resource methods. The
[selected lifecycle contract](write-lifecycle.md) records hook order, context
ownership, actual plugin consumers and the comparison of an API change, another
helper and a direct simplification of an existing helper. Hook names, setter
callback arguments and public resource behavior are retained.

The new `conformance-lifecycle` suite has **271 cases per storage mode**:
52 successful write traces across POST, PUT-create, PUT-update, PATCH and DELETE,
both representations, applicable returning modes and owned/borrowed transactions;
219 separately injected hook/setter/typed-getter failures. Enter/exit observations
cross an asynchronous boundary and assert exact order/counts, nested GET identity,
transaction identity/completion, auth, input transformations, minimal records and
responses. Failure assertions check the original error, stopped later stages,
rollback behavior and final stored state, including committed writes whose
after-commit hook fails.

Before changing the runtime, the suite passed **271/271 in each SQL/storage
combination, 1,626 total**, with no failures or skips
(`/tmp/library-lifecycle-trace-before-native.log`). The standalone initial
regular SQLite probe also passed all 271
(`/tmp/library-lifecycle-trace-initial.log`).

POST, PATCH and PUT now call the existing `applyFieldSetters(context, api, helpers)`
once at their original setter boundary. The helper owns the attributes-presence
check and assigns transformed attributes after the setter sequence succeeds.
This removes 27 repeated lines from those methods without a new helper, dispatch
table, callback wrapper or changed transaction boundary. The only direct test
import was migrated, and the migration guide records the internal signature
change. No jskit-ai caller imports this helper, so this change needs no consumer
source edit.

After that first simplification passed the full Node 22 gate and **2,082 native
checks** (347 in each SQL/storage combination), a second boundary was recorded
before editing: the existing response helper repeats finish hooks in three
return branches and normalization in two. Those operations now follow response
selection once. Four unused parameters and a dead uppercase DELETE branch were
removed; only POST/PATCH/PUT call this helper. `none` still returns undefined,
while full output still invokes the same nested GET. Method-specific storage and
relationship decisions remain in their methods. Across the three methods and
`common.js`, the two changes remove **105 lines** (1,505 to 1,400), with no new
runtime helper. First-stage logs are `/tmp/library-lifecycle-setters-full-gate.log`
and `/tmp/library-lifecycle-setters-native.log`; final verification includes the
fieldset suite as well.

Final gates pass on Node 22.16.0 and 24.6.0: **2400/2401 regular SQLite**
(one existing canonical-fixture-only skip), **2397/2397 canonical SQLite**,
**337/337 Express 4 per mode**, lint and docs. Each runtime passes **2,466 native
checks**, 411 per SQL/storage combination, with zero failures/cancellations/skips.
The four native files are `conformance-lifecycle`, `conformance-formats`,
`conformance-transaction-context` and `conformance-fieldsets`.

| Runtime | Full gate | Final native matrix |
| --- | --- | --- |
| Node 22.16.0 | `/tmp/library-lifecycle-final-full-gate.log` | `/tmp/library-lifecycle-final-native.log` |
| Node 24.6.0 | `/tmp/library-node24-lifecycle-final-full-gate.log` | `/tmp/library-node24-lifecycle-final-native.log` |

Commands are `npm run verify` and `node scripts/test-databases.js all` followed
by the four `tests/conformance-*.test.js` paths above. SQLite 3.49.2, PostgreSQL
16.15 and MySQL 8.0.46 use the existing disposable environments. Regular/canonical/
Express-4-regular/Express-4-canonical durations are 102.525/169.640/35.039/21.766
seconds on Node 22 and 137.657/130.522/14.184/13.553 on Node 24. Native
regular/canonical durations are SQLite 13.756/21.388, PostgreSQL 53.641/72.593,
MySQL 64.947/66.156 seconds on Node 22; SQLite 36.116/32.190, PostgreSQL
53.584/73.001, MySQL 44.331/29.941 on Node 24. Concurrent jobs make these execution
records unsuitable as performance comparisons. No remote CI run is claimed.

All 213 selected runtime/test/script/package/CI files matched across the two
tested copies and the saved hashes in `/tmp/library-lifecycle-tested-source.sha256`.
After every job finished, the Node 24 copy and its path record were removed.
All six runner directories for this lifecycle batch and the paused positioning
probes are absent. actionlint and `git diff --check` pass; final documentation
is rebuilt separately in `/tmp/library-lifecycle-final-docs.log`. The parked
migration SHA-256 remains
`81c454022208ba2c1bc8d2a893a4e3eb9d7d5c8b09d8e86a4bf435ea9b6e2d3e`.

**A4-02, A4-06, A4-07 and A4-15 are complete.** Verified total is **55/214
(25.7%)**, A48/138, B5/48, M2/14, C0/14; **159 remain**.
Relationship/bulk traces, generated-ID hook timing, secondary cleanup failures,
managed transaction outcomes and final response normalization remain separate
open requirements.

## 2026-09-09: Socket.IO Redis startup, shutdown and reconnection

This continues A2-16; verified completion remains **51/214 (23.8%)**, with
163 items open. No consumer repository or seed was changed.

The initial lifecycle probes reproduced failed Redis startup publishing a
partially initialized Socket.IO server and shutdown leaving both Redis clients
open (`/tmp/library-socket-lifecycle-before.log`, 0/3 passing). Expanded probes
also showed that failed-start authentication overrides survived into a retry
and overlapping starts could replace active server state. The intermediate
retry-count expectation was corrected: cleaning up the second client may prevent
its final retry callback, so both clients starting retries does not imply both
must exhaust them independently.

SocketIOPlugin now connects its owned Redis clients, with error listeners,
before attaching Socket.IO to the caller's HTTP server. A failed connection
destroys partial clients, awaits the connection attempts and preserves the
original failure, HTTP listeners and authentication configuration. Overlapping
or duplicate starts reject. Closing Socket.IO or its HTTP server clears the
published state and closes the owned Redis clients; ordinary resource operations
remain usable because the database remains caller-owned. The existing close API
is retained, with no new compatibility wrapper. Hooked-api variables are cleared
by assignment because their backing proxy does not implement property deletion.

The shared WebSocket fixture can delay Socket.IO startup. The new lifecycle
file has eight cases per storage mode: missing socket, invalid credentials,
one connected client followed by partner failure, exhausted retries, three
shutdown paths (including reconnection) and overlapping/duplicate starts.
Failed-start cases also verify a successful retry and original authentication.
Redis CLIENT LIST checks actual connection cleanup before fixture cleanup.

The notification suite adds eight cases per mode, dropping each publisher and
subscriber on each of two servers over polling and WebSocket. Tests await the
real client's ready event and verify subsequent delivery with the existing
Redis/client acknowledgement barriers. The existing 18 cases remain, bringing
the two files to **34 per storage mode, 68 per runtime**. Redis files execute
serially because their independently created APIs share one Pub/Sub namespace;
each notification case still exercises concurrent connections to two servers.

Both full gates pass: **2129/2130 regular** (one existing skip),
**2126/2126 canonical**, **337/337 Express 4 per mode**, lint and docs.
The native Socket.IO authorization suite passes **360/360** on Node 22,
60 in each SQL/storage combination
(`/tmp/library-socket-lifecycle-native-matrix.log`). Both runtimes pass **68/68
Redis cases** and the runner's **eight failure/interruption cases**, with zero
failures, cancellations or skips in those focused runs.

| Runtime | Full gate | Redis integration | Runner failures |
| --- | --- | --- | --- |
| Node 22.16.0 | `/tmp/library-socket-lifecycle-full-gate.log` | `/tmp/library-socket-lifecycle-final-redis.log` | `/tmp/library-socket-lifecycle-redis-runner.log` |
| Node 24.6.0 | `/tmp/library-node24-socket-lifecycle-full-gate.log` | `/tmp/library-node24-socket-lifecycle-redis.log` | `/tmp/library-node24-socket-lifecycle-redis-runner.log` |

Regular/canonical/Express-4-regular/Express-4-canonical test durations were
66.197/68.195/13.830/12.815 seconds on Node 22 and
58.637/59.227/7.488/8.302 seconds on Node 24. Redis durations were
20.631/24.568 and 20.198/20.439 seconds respectively; the runner suites took
20.071 and 19.509 seconds. Some jobs ran concurrently, so these are execution
records rather than performance comparisons.

Commands are `npm run verify`, `npm run test:redis`,
`node scripts/test-databases.js all tests/conformance-socketio-authorization.test.js`
and `JSON_REST_API_RUNNER_DATABASE=redis node --test tests/database-runner.test.js`,
using the disposable binaries documented in the database/Redis guides. Runtime
versions are Node 22.16.0 and 24.6.0, Redis 7.0.15, Socket.IO 4.8.1 and adapter
8.3.0. Node 24 uses a separate temporary install for its native SQLite dependency.
actionlint and `git diff --check` pass locally; no remote CI run is claimed.

The 212 selected runtime/test/script/package/CI files match between the root
checkout and the Node 24 test copy. Their hashes are recorded in
`/tmp/library-socket-lifecycle-tested-source.sha256`. All three successful native
runner directories are absent; the sixteen runner-failure cases assert their own
cleanup. The parked migration patch SHA-256 remains
`81c454022208ba2c1bc8d2a893a4e3eb9d7d5c8b09d8e86a4bf435ea9b6e2d3e`.
After all jobs finished, the temporary Node 24 copy and its path record were
removed. No owned native test server remained. Final prose is rebuilt with
`npm run docs`; its log is `/tmp/library-socket-lifecycle-final-docs.log`.

The Socket.IO, Redis and API migration guides describe ownership and retry
behavior. Cluster/Sentinel failover, durable delivery, an unresponsive open
network connection and forced process termination are outside this coverage.
Outer-transaction notification timing remains A7/B2. A2-16 also remains open:
the audit identified PositioningPlugin as a documented deep import whose four
historical test files explicitly use SQLite. PostgreSQL/MySQL positioning is
the next capability gap to check, not a claimed backend defect.

## 2026-09-09: labels, computed visibility, real Redis and sparse fieldsets

This is further A2-16 capability-audit work, not completion of the full audit.
The master remains **51/214 (23.8%)**, A44/138, B5/48, M2/14, C0/14.
Consumer repositories and seeds remain on hold.

Label regressions reproduced private-field disclosure, deleted authored labels,
ignored global-search aliases, missing null fallbacks and empty logical-ID
fallbacks. The corrected pre-fix tests passed 14/32 with 18 real failures
(`/tmp/library-label-conformance-corrected-before.log`). Later visibility probes
failed 0/4 when hidden/normally hidden computed values were returned. A virtual
dependency probe also reproduced a nonexistent SQL-column selection caused by
the old fallback that fetched every normally hidden field.

LabelPlugin now preserves authored stored/computed labels, uses only public
stored candidates, declares its actual dependencies and uses the resource's
logical ID as its final fallback. Computed callbacks receive that ID separately
from attributes, including included resources with custom IDs. Visibility is
applied after computed/virtual enrichment. The unnecessary normally-hidden
compatibility fallback is removed; declared virtual dependencies are not SQL
columns. The label and API migration guides document the behavior and authored
label storage migration check.

The final label suite has 50 cases per storage mode. Labels/values/temporal
passed **995 native checks** on Node 22: SQLite 165/166, PostgreSQL 165/167,
MySQL 165/167, all zero failures/skips
(`/tmp/library-label-visibility-fixed-matrix.log`). Subsequent full gates on
Node 22 and 24 passed their tests (2047/2048 regular with one existing skip,
2044 AnyAPI, 328 Express 4 per mode), then failed on one padded-block lint error.
That formatting error was corrected before the fieldset batch below; those
partial gates are not recorded as successful full verification.

The existing disposable-database runner now starts Redis over a private Unix
socket, checks PING/INFO readiness and cleans up its process group and directory.
Two actual Socket.IO servers share an application database and exchange events
through Redis. Tests cover CRUD in both directions, trusted workspace/row-policy
context, leaving a result, rollback, all relationship writes and a replaced
queued subscription. Negative assertions use Redis and client acknowledgements.
The shared row-policy fixture can register its second API without recreating
tables. No production Socket.IO runtime was changed for this integration batch.

Redis 7.0.15, Socket.IO 4.8.1 and adapter 8.3.0 passed **36 notification cases
and eight runner-failure/interruption cases on each runtime**, without skips:

| Runtime | Notifications | Runner failures |
| --- | --- | --- |
| Node 22.16.0 | `/tmp/library-redis-notifications-relationships.log` | `/tmp/library-redis-runner-failures.log` |
| Node 24.6.0 | `/tmp/library-node24-redis-notifications.log` | `/tmp/library-node24-redis-runner.log` |

The workflow adds two required Redis jobs, one per maintained Node version.
It now has two library jobs and six native jobs. actionlint passes; these are
local command results, not a claim of a remote GitHub run. This verifies two
servers in one process with a real Redis bus and SQLite application storage.
Production Redis startup failure, shutdown, reconnection and failover remain
unverified; the [Redis guide](real-redis.md) makes those limits explicit.

Sparse fieldset probes found valid relationship aliases rejected and empty
fieldsets treated as unrestricted reads. The final **64-case** regression file
failed all 64 cases against the pre-fix Node 24 runtime
(`/tmp/library-node24-fieldsets-before.log`). With the fix, all 64 pass in both
storage modes on SQLite (`/tmp/library-fieldsets-kinds-sqlite.log`) and in all
six SQL/storage combinations on Node 24 (**384 checks**,
`/tmp/library-node24-fieldsets-native-matrix.log`).

The fieldset parser and response projection live in the existing `field-utils`
module. The existing relationship resolver moved from method `common.js` into
`relationship-contracts.js`; all imports were moved, with no forwarding shim.
SQL selection retains internal keys/sort values/dependencies. GET/query remove
unrequested attributes and relationships after read hooks, including included
resources. Unselected computed fields do not execute. Full write responses use
the same GET selection, preserving stored input.

Coverage includes both public formats, custom IDs and column mappings,
belongs-to/has-one/has-many/polymorphic/many-to-many relationships, nested included
types, late read-hook additions and POST/PATCH/PUT responses. Eighteen additional
HTTP cases per storage mode cover Express 5/Fastify 5; nine also run on Express 4.
Existing computed/getter/include/permission tests now explicitly select the
relationships they inspect, without relaxing their authorization assertions.
The migration guide shows the required `fields` changes and preserves the
JSON:API distinction between included objects and relationship linkage.

Initial drafts incorrectly supplied object/foreign-key plain inputs, omitted
PUT linkage and mixed explicit fixture IDs with a PostgreSQL-generated sequence.
Those test errors were corrected to the already selected API and explicit
fixture IDs. The first expanded full run exposed 23 old expectations for
unrequested relationships. Two remaining pagination checks then needed their
request/link field names synchronized. These failures are retained in
`/tmp/library-fieldsets-suite-first.log`, `/tmp/library-fieldsets-full-gate.log`
and `/tmp/library-fieldsets-native-matrix.log`; they are not successful gates.

Final `npm run verify` passed on both runtimes:

| Job | Node 22.16.0 | Node 24.6.0 |
| --- | --- | --- |
| Regular SQLite | 2129/2130, one existing skip, 108.997 s | 2129/2130, one existing skip, 108.454 s |
| Canonical SQLite | 2126/2126, 130.586 s | 2126/2126, 128.076 s |
| Express 4 regular | 337/337, 21.704 s | 337/337, 21.281 s |
| Express 4 canonical | 337/337, 21.788 s | 337/337, 21.316 s |
| Lint | Passed | Passed |
| Docs | Passed, 4.164 s | Passed, 4.208 s |

There were no failures or cancellations. Logs:
`/tmp/library-fieldsets-final-full-gate.log` and
`/tmp/library-node24-fieldsets-full-gate.log`. Both jobs ran alongside native
verification; these durations are verification evidence, not benchmarks.

The Node 22 five-suite native matrix (fieldsets, labels, authorization, related
reads and queries) passed **1,728 checks**: 289 regular and 287 canonical per
database, with zero failures/cancellations/skips
(`/tmp/library-fieldsets-final-native-matrix.log`). The Node 24 **384-check**
native run selected fieldsets only; it is not a repeat of the entire expanded
five-suite matrix. Both full gates do include the other suites on SQLite.

Real Redis notifications were rerun after the fieldset changes: **36/36** on
each runtime, no failures/skips (`/tmp/library-fieldsets-redis-final.log`,
`/tmp/library-node24-fieldsets-redis-final.log`). actionlint and `git diff --check`
pass. Runtime/tests/scripts/package/CI sources match the private Node 24 copy
across 209 files; `/tmp/library-fieldsets-tested-source.sha256` records the
tested snapshot and was checked again after all test jobs ended. The idle
private Node 24 copy and its path record were removed. The final evidence-only
prose update is followed by a separate documentation build.

The parked migration patch still matches
`81c454022208ba2c1bc8d2a893a4e3eb9d7d5c8b09d8e86a4bf435ea9b6e2d3e`.

## 2026-09-09: expanded driver conformance and CI

The default database runner now discovers all nineteen shared conformance files,
plus five environment/schema/migration files. The bulk-authorization,
relationship-write and Socket.IO-authorization suites no longer create SQLite
connections directly. The shared database helper rejects a fixture that supplies
a driver different from the selected integration job. Query-fixture canonical
membership cleanup is registered with the existing storage cleanup helper.

The initial ten-file expansion reproduced a PostgreSQL search defect: **494/503**
tests passed, six failed on `integer ~~ unknown` (SQLSTATE `42883`), and three
were cancelled by SQLite-specific collation setup. MySQL passed **500/503**, with
those same three fixture cancellations and no assertion failures. These failed
runs reached regular storage only; neither supplied canonical evidence.

The existing `applyWhereForOperator` now casts PostgreSQL columns to text for
`like`/`contains`/`startsWith`/`endsWith`. Equality, range and ordering retain their
original type and collation. Permanent cases cover ordinary, joined and
polymorphic numeric references, visibility, both response formats, leading zeros
and exponent suffixes. They do not introduce another value normalizer. An initial
test expected leading whitespace to survive authored string validation; that
expectation was corrected after confirming the existing trimming contract.
The search/sort fixture uses equivalent native case-insensitive collations while
retaining its original equality/order assertions. The focused matrix passes
**906 checks** across all six database/storage combinations.

The expanded Node **22.16.0** default matrix passes **6,849 checks**, no failures,
cancellations or skips:

| Actual database | Regular checks / duration | AnyAPI checks / duration |
| --- | ---: | ---: |
| SQLite 3.49.2 | 1,138 / 25.736 s | 1,137 / 33.066 s |
| PostgreSQL 16.15 | 1,146 / 77.660 s | 1,146 / 90.410 s |
| MySQL 8.0.46 | 1,141 / 97.342 s | 1,141 / 149.079 s |

The full Node 22 `npm run verify` passes **1996/1997 regular** (one existing skip),
**1993/1993 AnyAPI**, **328/328 Express 4 per mode**, lint and documentation.
Durations are 65.800 / 57.293 / 10.128 / 11.116 seconds, with Jekyll generation
2.047 seconds. The database runner's seven permanent failure tests pass on each
of SQLite, PostgreSQL and MySQL (**21 checks**): test failure, SIGINT, SIGTERM,
missing PostgreSQL, missing MySQL, missing test file and mismatched fixture driver.
They verify nonzero exit, temporary-directory removal and stopped native PIDs.
The full matrix's private directory and both native server PIDs were separately
confirmed removed/stopped after completion.

The new workflow has two full-library jobs and four PostgreSQL/MySQL jobs,
crossing Node 22.16.0 and 24.6.0. Each native job runs both storage modes and the
seven failure checks. Native servers remain disposable with explicit readiness.
Pinned official actions, read-only permissions, independent matrix reporting and
bounded job times are used. The final `Verification` job accepts only successful
library and database results. `actionlint` **1.7.11** passes, and executing that
job's actual shell body against all sixteen success/failure/cancelled/skipped
result combinations accepted only two successful dependencies. There is no
`continue-on-error`, service-absence skip or path-filtered integration job.

Node **24.6.0** verification also passes in a private copy after a fresh `npm ci`.
The copied runtime, scripts, tests, workflow and package definitions match the
workspace byte for byte (201-file SHA-256 manifest), and all 535 actually
installed package versions match. Native dependencies in the workspace were
not replaced. The installation reported 19 dependency audit findings (7 moderate,
12 high); those remain for the package/dependency review and were not
automatically rewritten.

Its full `npm run verify` passes the same **1996/1997 regular**, **1993/1993
AnyAPI**, and **328/328 Express 4 per mode**, plus lint and docs. Durations are
40.213 / 53.067 / 10.007 / 11.199 seconds; Jekyll generation is 2.624 seconds.
Its default matrix also passes **6,849 checks**, no failures/cancellations/skips:

| Actual database | Node 24 regular checks / duration | Node 24 AnyAPI checks / duration |
| --- | ---: | ---: |
| SQLite 3.49.2 | 1,138 / 69.775 s | 1,137 / 59.463 s |
| PostgreSQL 16.15 | 1,146 / 73.231 s | 1,146 / 94.883 s |
| MySQL 8.0.46 | 1,141 / 96.384 s | 1,141 / 124.245 s |

The native matrices therefore execute **13,698 checks** across both runtimes,
including explicitly repeated fixed-storage cases. These are verification runs,
not performance benchmarks; independent jobs overlapped on this workstation.
Node 24's seven runner-failure cases pass on PostgreSQL (9.580 s) and MySQL
(54.741 s); its full SQLite gate executes those same seven cases too. Its matrix
directory and both native server PIDs were confirmed removed/stopped. The private
Node 24 source/dependency copy is removed after final source reconciliation.

| Item | Acceptance evidence |
| --- | --- |
| A3-02 | All shared conformance files on actual `better-sqlite3`/`pg`/`mysql2`, both storage modes, on Node 22 and 24; preserved assertions, native collations and documented fixed-storage/unverified combinations |
| A1-08 | Reviewed/linted workflow with both supported Node baselines, full real connector gate, four native jobs, disposable databases and explicit readiness; all underlying job commands executed locally |
| A3-12 | Seven permanent failure/cleanup cases on all three databases and both runtimes, plus all sixteen aggregate-result combinations; omitted local integrations documented as not run |

These three items are complete. This is local workflow validation and execution
of its commands; **no remote GitHub run or branch-protection change is claimed**.

Logs in `/tmp`: `library-expanded-conformance-pg-before.log`,
`library-expanded-conformance-mysql-before.log`,
`library-search-patterns-first-matrix.log`,
`library-all-conformance-first-matrix.log`,
`library-all-conformance-full-gate.log`,
`library-database-runner-strict-{sqlite,pg,mysql}.log`,
`library-node24-driver-install.log`,
`library-node24-driver-{full-gate,matrix}.log`,
`library-node24-runner-strict-{pg,mysql}.log`, and
`library-driver-ci-tested-source.sha256`.
The [coverage map](conformance.md#expanded-database-coverage) and
[database/CI guide](real-databases.md) distinguish executed combinations,
fixed-storage cases, intentionally omitted local environments and remaining
optional integrations. Consumer work remains on hold and its parked patch is
unchanged. Verified total: **51/214 (23.8%)**, A44/138, B5/48, M2/14, C0/14;
**163 remain**. A2-16's complete capability reconciliation, later lifecycle/API
work, consumer migration and the final three reviews remain open.

## 2026-09-09: concurrent relationship integrity and native failures

The next A3-06 batch reproduced failures that single-connection fixtures could
not show. The tests hold one completed resource operation in an uncommitted
transaction while a second transaction attempts a competing write, with explicit
native lock timeouts. Other cases pause after validation and commit a competing
change before the write resumes. Assertions inspect full inverse collections and
physical edge counts, so a hasOne response or deduplicated map cannot hide extra
stored membership.

Before correction:

- PostgreSQL regular storage passed **12/17** cases: reverse hasMany/hasOne/
  polymorphic replacements merged both requests, many-to-many replacements
  merged, and repeated additions duplicated a pivot edge
  (`library-relationship-races-pg-before.log`). A forced canonical invocation
  also passed **12/17** with the same five failures
  (`library-relationship-races-pg-anyapi-before.log`).
- MySQL regular storage passed **15/17**, exposing the many-to-many replacement
  and duplicate-edge failures (`library-relationship-races-mysql-before.log`).
- Adding older repeatable-read snapshots reproduced two more PostgreSQL failures:
  **12/19** passed (`library-relationship-races-snapshots-before.log`).
- After parent locking, the inverse-endpoint case still duplicated an edge:
  **19/20** PostgreSQL regular cases passed
  (`library-relationship-races-inverse-before.log`).
- POST, PUT and PATCH each attached an ordinary or polymorphic belongs-to
  reference after its target was deleted: **27/33** PostgreSQL regular cases
  passed (`library-relationship-races-to-one-before.log`).

Changes reuse the existing storage adapter and relationship processor. A small
parent-lock helper performs a scoped ID-preserving UPDATE before collection
mutation; the row version change rejects stale PostgreSQL repeatable-read
writers. A shared target-lock helper rechecks referenced rows through the same
adapter. Many-to-many operations lock targets, including inverse endpoints, and
read existing membership with locking queries. The existing canonical link
loader accepts a locking read for synchronization/removal. The relationship
processor supplies its already validated belongs-to identifiers to resource
POST/PUT/PATCH; their ordinary and polymorphic targets are locked before writing.
No field-conversion copy, transaction framework or automatic retry was added.

The tests also exposed missing canonical link cleanup in the ID fixture. Its
mapping is now registered with the existing cleanup helper, including the inverse
relationship. An initial edit matched the adjacent query fixture instead; the
remaining canonical rows exposed that mistake and the registration was moved to
the intended fixture before final verification. Full-suite query/ID checks remain
part of the gate.

`conformance-transactions` now has **32 SQLite / 33 PostgreSQL / 33 MySQL** cases.
It covers resource and relationship replacements, opposite endpoint additions,
parent/target deletion after validation, generated identities, private writes,
rollback, repeatable snapshots, disjoint PATCH fields and atomic bulk visibility.
The extra native case creates a real deadlock and verifies that only the winning
transaction's two writes persist after owner completion. SQLite asserts its busy
and stale-snapshot conflicts instead. A borrowed Knex wrapper remaining incomplete
does not mean a failed native transaction is still usable; the database may have
aborted it, and the caller still performs rollback/retry.

Together with sixteen reused-context cases, the focused matrix passes **292
checks**, without failures/skips (`/tmp/library-relationship-races-complete-matrix.log`,
exit 0): **48/48 per SQLite mode**, **49/49 per PostgreSQL/MySQL mode**. Durations:
**1.834/3.151 s SQLite**, **9.305/12.429 s PostgreSQL**, **20.652/23.132 s MySQL**.

Full `npm run verify` passes on Node 22.16.0
(`/tmp/library-relationship-races-full-gate.log`, exit 0): **1989/1990 regular**
(one existing skip), **1986/1986 AnyAPI**, **328/328 Express 4 per storage mode**,
lint and docs. Durations: **31.843/52.308/7.839/8.692 s**; docs **1.554 s**.

Full `npm run test:databases` passes **2,859 checks** in eleven suites without
failures or skips (`/tmp/library-relationship-races-full-matrix.log`, exit 0):

| Database | Regular invocation | AnyAPI invocation | Duration, regular / AnyAPI |
| --- | --- | --- | --- |
| SQLite | 473/473 | 472/472 | 6.709 / 12.387 s |
| PostgreSQL 16.15 | 481/481 | 481/481 | 23.077 / 30.178 s |
| MySQL 8.0.46 | 476/476 | 476/476 | 42.457 / 52.723 s |

The four fixed-storage schema/evolution suites retain their documented scope;
repeating them in both invocations does not cover the other storage backend.
Every transaction invocation uses the actual selected driver and storage mode.

A3-06 acceptance evidence is now complete:

| Requirement | Evidence |
| --- | --- |
| Commit and rollback | Private POST/full responses; owner commit/rollback of records and multiple relationship kinds; later-child failure; atomic batch success/failure; sixteen reused-context cases covering all seven write methods |
| Concurrent connections | Physical connection identities differ; independent observers cannot see uncommitted writes; native generated-ID writers overlap; SQLite rejects the second active writer |
| Isolation-sensitive updates | Repeatable reads retain snapshots; disjoint PATCH fields survive overlap; stale membership replacements either observe current rows or produce the native conflict and succeed after owner rollback/retry |
| Relationship integrity | Complete inverse collections and physical edge counts; resource PATCH/PUT and relationship routes; same/inverse endpoint additions; parent/target deletion after validation; six ordinary/polymorphic reference races across POST/PUT/PATCH |
| Failure and recovery under actual contention | Bounded native lock timeouts, SQLite busy/snapshot failures, PostgreSQL/MySQL deadlocks, and final stored rows belonging only to the winning transaction |

**A3-06 is complete.** A3-02's full driver coverage, A3-12's required CI jobs,
A7/B2 transaction outcome/cleanup/bulk borrowing/deferred-notification work,
and the final reviews remain open. Verified total is **48/214 (22.4%)**,
A41/138, B5/48, M2/14, C0/14; **166 remain**.

All runner-owned directories recorded in this batch's logs were removed,
including `/tmp/jra-db-HD3koP`; its observed MySQL process was stopped. Final
documentation rebuild and `git diff --check` pass.

The migration guide documents database UPDATE-trigger effects, native conflict
errors, caller rollback and whole-transaction retry boundaries, and inspection of
already duplicated edges. Existing duplicates are not silently removed. This
batch requires no column migration and does not introduce automatic delete
cascades or constraints for arbitrary direct SQL. Consumer repositories and seeds
remain on hold; the parked migration patch is unchanged.

## 2026-09-09: separate-connection application transactions; A3-06 in progress

Added `tests/conformance-transactions.test.js`: twelve public-operation cases
using actual separate connections. The shared test database helper now supports
an explicitly requested disposable SQLite WAL file with a four-connection pool,
foreign keys enabled on every connection, immediate busy errors and directory
cleanup. This changes test infrastructure only; runtime transaction behavior is
unchanged in this batch.

Checks cover uncommitted POST visibility, belongsTo response includes and related
reads inside the owner transaction; owner commit/rollback; rollback across reverse
hasMany/hasOne/polymorphic and many-to-many changes; later-child failure; repeatable
snapshots; overlapping disjoint PATCH writes; and atomic bulk batch visibility
and failure. Native concurrent generated-ID inserts return distinct IDs before
commit. SQLite asserts its single-writer conflict and retries after releasing the
first transaction. No never-reuse promise is made for rolled-back generated IDs.

The existing sixteen reused-context cases now run on real drivers too. Their
intentional failing POST uses an explicit free ID: explicit fixture seed IDs do
not advance PostgreSQL's sequence and must not mask the intended finish-hook
failure. Barriers are bounded, release in `finally`, and borrowed transactions
are cleaned up after assertions fail. Initial new-test failures were fixture
mistakes (explicit undefined document members and an include supplied outside
`queryParams`), corrected before recording driver results. Formatting findings
were also corrected before the full gate.

The focused two-suite matrix passes **28/28 per storage invocation on each of
SQLite, PostgreSQL 16.15 and MySQL 8.0.46: 168 checks**, no failures or skips
(`/tmp/library-concurrent-transactions-generated-before.log`, exit 0). Durations
are **0.594/0.669 s SQLite**, **0.961/1.344 s PostgreSQL**, **1.153/2.510 s MySQL**.
Its disposable server directory `/tmp/jra-db-69STkf` was removed on completion.
Both suites are now included in the default eleven-suite database matrix.

Full `npm run verify` passes on Node 22.16.0
(`/tmp/library-concurrent-transactions-full-gate.log`, exit 0): **1969/1970
regular** (one existing skip), **1966/1966 AnyAPI**, **328/328 Express 4 per
storage mode**, lint and docs. Test-stage durations are **44.224/56.611/11.133/
12.201 s**; docs **2.847 s**.

The expanded eleven-suite `npm run test:databases` matrix passes **2,735 checks**
without failures/skips (`/tmp/library-concurrent-transactions-full-matrix.log`,
exit 0):

| Database | Regular invocation | AnyAPI invocation | Duration, regular / AnyAPI |
| --- | --- | --- | --- |
| SQLite | 453/453 | 452/452 | 27.119 / 35.174 s |
| PostgreSQL 16.15 | 460/460 | 460/460 | 55.169 / 33.896 s |
| MySQL 8.0.46 | 455/455 | 455/455 | 33.777 / 46.534 s |

The four fixed-storage schema/evolution suites retain their earlier scope limits;
repeated invocations do not claim coverage of the other storage backend. The
new transaction suites exercise the selected storage and actual requested driver
in every invocation. The runner removed `/tmp/jra-db-LPM3B2` and stopped its
servers. Final documentation rebuild and `git diff --check` pass.

**A3-06 remains open.** Competing relationship replacements, lock/deadlock
outcomes and further integrity races are still outstanding; atomic bulk borrowing
and outcome/deferred-notification behavior retain A7/B2 requirements. This batch
makes no claim that those unchecked contracts are correct. Verified checklist
total remains **47/214 (22.0%)**, with **167 remaining**. Consumer repositories
and seeds remain on hold; the parked patch checksum is unchanged.

## 2026-09-09: direct alterations and schema literals, A3-05 complete

The direct enum defects recorded in the previous batch are corrected.
`dbTablesOperations.js` now shares the existing enum-change planning between
direct alterations and generated diffs. PostgreSQL alters the text column and
replaces the appropriate check in a transaction; deep callers retain their
outer transaction through a savepoint. SQLite rejects enum changes that need
replacing the check before any requested field changes. MySQL uses one native
ALTER statement and rejects a borrowed transaction before an implicit commit.

The SQLite/PostgreSQL column/check readers were extracted from the existing
introspectors in `dbIntrospection.js`, retaining the same parsers and queries.
Direct column alterations therefore do not inherit full resource-snapshot
restrictions on primary keys or indexes. Tests cover opaque primary keys,
physical names with spaces, PostgreSQL qualified tables and unrelated partial
indexes. No new runtime module or schema engine was introduced.

Review also corrected schema-literal and constraint handling:

- Knex's enum compiler interpolates values without SQL escaping. Apostrophes
  broke table creation on all three databases; runtime/generated DDL now escape
  them. PostgreSQL uses a text/check declaration with Unicode string literals
  where necessary, keeping literal question marks away from Knex's binding
  rewrite. Static text defaults use the same PostgreSQL literal handling.
- JSON/array defaults use explicit JSON type/default expressions, avoiding
  Knex's unescaped object interpolation and MySQL's serialization of raw Knex
  objects. Raw-literal escaping preserves backslashes before question marks.
  Standalone generators reject SQL-sensitive literals without a target dialect;
  resource-level generation already obtains the actual client dialect.
- MySQL enum/SET introspection decodes native backslash escapes. Generated JSON
  defaults decode only recognized string-literal expressions, using the existing
  literal parser, without evaluating SQL. Unchanged declared defaults then produce
  an empty second diff.
- Constraint matching preserves quoted identifier case. Changing PostgreSQL
  `role` no longer removes the check on a distinct `Role` column. Constraint names
  are quoted through Knex's identifier formatter, including mapped-column names
  containing spaces.

The first implementation unnecessarily wrapped SQLite's own transactional
rebuild. A parent/child regression caught that this prevented its foreign-key
toggle and cascaded a child deletion: **10/11 passed**
(`/tmp/library-direct-alterations-sqlite-parent-before.log`, 0.891 s). That wrapper
was removed. Standalone calls use Knex's existing rebuild transaction and
enforcement restoration; borrowed SQLite rebuilds reject enabled foreign keys
before any DDL. Owners opting into a borrowed rebuild must disable enforcement
before their transaction, validate it before commit, and restore it afterward.
Tests exercise both the guarded case and successful/failed savepoint ownership.

Permanent coverage now comprises **33 SQLite / 36 PostgreSQL / 37 MySQL**
`db-schema-conformance` cases and **14 / 18 / 12** `db-field-alterations` cases.
The new direct suite and expanded regular schema suite always use regular
tables, even during the AnyAPI invocation. Two MySQL SET cases additionally
execute creation, introspection, direct/generated alteration, escaped values,
rejected invalid values, and preservation of existing rows.

Reproduction and review evidence includes:

| Stage | Observed result |
| --- | --- |
| Initial escaped-enum fixtures | SQLite 0/10, PostgreSQL 0/12, MySQL 0/10: creation failed before alteration assertions (`library-direct-alterations-before-*`) |
| First implementation | SQLite 70/70 across four files; PostgreSQL 43/43 and MySQL 40/40 per invocation across two files (`library-direct-alterations-first-*`) |
| Case/backslash review | PostgreSQL 45/47, including a genuine wrong-check deletion and a generated-case fixture missing its explicit column mapping; MySQL 40/42 for doubled backslashes (`library-direct-alterations-review-*`) |
| Corrected case/backslash review | PostgreSQL 47/47 and MySQL 42/42 per invocation (`library-direct-alterations-fixed-*`) |
| Further literal/name review | PostgreSQL 45/48: two question-mark enum failures and an unquoted constraint name (`library-direct-alterations-literal-review-before`) |
| JSON/default review | Detected invalid object-default SQL and then false MySQL diffs for generated JSON defaults; corrected SQLite 78/78 and MySQL 46/46 per invocation before the final table-name/SET additions (`library-direct-alterations-final-*-checked`) |

These log names are under `/tmp/` with `.log` extensions. Syntax/formatting issues
in intermediate edits were corrected before the final gate. The older temporary
probe expecting SQLite enum replacement success is superseded by permanent tests
of the documented rebuild requirement, not counted as a successful migration.

Final `npm run verify` passes on Node 22.16.0
(`/tmp/library-direct-alterations-full-gate.log`, exit 0): **1957/1958 regular**
(one existing skip), **1954/1954 AnyAPI**, **328/328 Express 4 per mode**, lint and
docs. Test-stage durations: **39.197 / 58.490 / 12.116 / 13.020 s**; docs **3.060 s**.

Final `npm run test:databases` passes **2,567 checks** in nine suites, without
failures/skips (`/tmp/library-direct-alterations-full-matrix.log`, exit 0):

| Database | Regular invocation | AnyAPI invocation | Duration, regular / AnyAPI |
| --- | --- | --- | --- |
| SQLite | 425/425 | 424/424 | 19.278 / 33.815 s |
| PostgreSQL 16.15 | 432/432 | 432/432 | 56.037 / 36.942 s |
| MySQL 8.0.46 | 427/427 | 427/427 | 33.830 / 58.434 s |

The last two SET cases were added before the matrix started MySQL; they are
MySQL-only and do not change the completed SQLite full-gate assertions. The
matrix contains them in both native MySQL invocations. All completed focused-run
directories/servers were checked as cleaned up, as were final directory
`/tmp/jra-db-0vLaKV` and server PIDs 4139195/4141777.

A3-05 acceptance is now established by actual driver execution:

| Requirement | Evidence |
| --- | --- |
| Schema creation and introspection | Regular direct/generated creation, actual public wrappers, canonical table creation/guards, typed metadata and declared schema limits |
| Migration generation | Executed create up/down and diff up; enum/default/precision changes, composite foreign-key/index dependencies and SET changes with existing rows |
| Static/function defaults | Stored primitive/JSON/array defaults, escaped values, function defaults omitted from SQL but run by the public API, canonical additions/redeclaration |
| Storage mappings | Custom physical IDs, explicit fields, snake/exact naming, canonical slots/relationships and tenant-specific persisted descriptors |
| Canonical existing data | Twenty native temporal migration cases plus thirteen field-evolution cases recorded below, including rollback and startup guards |

The guide and migration guide explain the changed behavior and transaction
boundaries. This does not complete A3-06's concurrent application transactions,
isolation and relationship-integrity work, A3-02's complete driver coverage,
A3-12's CI requirements, A5's broader metadata work, or final Part C reviews.
SQLite manual enum rebuilds, arbitrary SQL default expressions and native
PostgreSQL enum types are not claimed as supported automatic alterations.

Verified total: **47/214 (22.0%)**, A40/138, B5/48, M2/14, C0/14. Consumer
repositories and seeds remain untouched; the parked patch checksum is unchanged.

## 2026-09-09: public table helpers and composite dependencies, A3-05 in progress

Regular public `addKnexFields` and `alterKnexFields` omitted resource-level
`storage.naming`. With exact naming, an addition created the wrong snake-case
column and a SQLite alteration silently left the intended column's default
unchanged. Both wrappers now forward the existing storage configuration; no new
mapping or schema compiler was introduced. `idProperty` already named the
physical primary key correctly and required no change.

Eight public-helper cases cover both naming settings, custom physical IDs,
explicit field mappings, direct/generated creation, runtime versus SQL defaults,
computed/virtual fields absent from storage, empty migration diffs, additions and
default alterations. The initial test used `getter` for a computed field; fixing
that fixture to use the existing `compute` contract left **21/23 passing** before
the runtime fix (`/tmp/library-schema-public-before-corrected.log`, 0.414 s).
The two remaining failures reproduced the naming bugs. Computed-field table
exclusion was already correct and was not changed.

Composite dependency execution found a separate MySQL failure: replacing a
foreign-key-supporting index raised `ER_DROP_INDEX_FK`. The initial native run
passed **27/28**, with that one failure
(`/tmp/library-schema-public-mysql2-before.log`, 6.691 s). The diff now adds an
unchanged dependent key to its existing drop/recreate steps when a supporting
index is dropped. Already-changing keys are not duplicated. The corrected
MySQL run passed **28/28 in each invocation**, 3.506/3.490 s
(`/tmp/library-schema-public-mysql2-fixed.log`). PostgreSQL's initial execution
passed **29/29 per invocation**, 1.408/1.988 s
(`/tmp/library-schema-public-pg-before.log`).

Review expanded composite coverage to five cases: index replacement, changed
referential actions, both together, removal of unwanted uniqueness, and explicit
column drops. Checks verify composite column order, preserved rows, rejection of
cross-pair references, cascading updates/deletes, and an empty second diff.
Together with the eight public cases, this adds **13 permanent tests** to the
existing real-table suite: **28 SQLite / 31 PostgreSQL / 30 MySQL**. The suite
always uses regular storage; its repetition in the AnyAPI invocation does not
verify canonical DDL. SQLite's three schema-related files pass **60/60**, no
skips, 0.569 s (`/tmp/library-schema-public-review-sqlite.log`).

The guide describes regular helpers as DDL operations, explains the naming fix
and existing-data inspection, and makes MySQL's multi-statement foreign-key
replacement and implicit-commit recovery requirements explicit.

The full `npm run verify` test stages pass on Node 22.16.0:
**1938/1939 regular** (one existing skip), **1935/1935 AnyAPI**, and **328/328
Express 4 per mode**, without failures; durations 45.275/59.543/12.361/12.173 s.
The command then stopped on two formatting errors in the new test
(`/tmp/library-schema-public-full-gate.log`, exit 1). Those braces were reformatted
without changing test behavior; lint and documentation are verified separately
below rather than describing that initial command as successful.

A separate public-helper probe, `/tmp/jra-direct-enum-review.mjs`, confirms the
remaining direct-alteration defect. Of three assertions (change default, replace
allowed values, remove enum), SQLite passes **1/3**, PostgreSQL **0/3**, and MySQL
**3/3 per invocation** (`/tmp/library-direct-enum-review-{sqlite,pg,mysql2}.log`).
PostgreSQL emits invalid `ALTER COLUMN TYPE text check ...` syntax for enum
definitions; PostgreSQL and SQLite retain the old check when converting to a
plain string, and SQLite retains the old allowed values when replacing an enum.
These failures are still open; passing permanent tests does not supersede them.
The next step is to fix direct alterations with regression coverage and examine
failure atomicity. All probe/native focused-run directories and servers were
confirmed cleaned up.

No checklist item is newly closed: **46/214 (21.5%)**, A39/138, B5/48, M2/14,
C0/14. A3-05 remains open. Consumer repositories and seeds remain untouched, and
the parked migration patch hash is unchanged.

The complete eight-suite `npm run test:databases` command passes **2,445 checks**,
without failures/skips (`/tmp/library-schema-public-full-matrix.log`, exit 0):

| Database | Regular invocation | AnyAPI invocation | Duration, regular / AnyAPI |
| --- | --- | --- | --- |
| SQLite | 406/406 | 405/405 | 25.650 / 32.709 s |
| PostgreSQL 16.15 | 409/409 | 409/409 | 57.047 / 33.783 s |
| MySQL 8.0.46 | 408/408 | 408/408 | 30.724 / 44.615 s |

The fixed-storage suites retain their stated scope limits. Directory
`/tmp/jra-db-fvGXwW` and server PIDs 4113756/4115988 were confirmed removed/stopped.
Corrected full lint passes (`/tmp/library-schema-public-final-lint.log`, exit 0).
Only documentation and test whitespace changed after the passing runtime checks.
The documentation build passes (`/tmp/library-schema-public-final-docs.log`,
exit 0, 1.222 s). `git diff --check` passes, and the final checklist recount
remains 46/214.

## 2026-09-09: canonical field additions, A3-05 in progress

The previously recorded `AnyAPI.addKnexFields` failure is corrected. Initial
permanent coverage failed **0/9 passed** on SQLite
(`/tmp/library-field-evolution-before.log`, 60.647 s). Public additions failed
at the invalid `scope.scopeOptions.schema` access, initial explicit maps were
ignored until `createKnexTable`, invalid slot numbers were accepted, and a
borrowed allocation read its descriptor outside the transaction, exhausting the
single-connection SQLite pool. These failures precede the implementation fix.

The changes use existing owners and remove obsolete work:

- The plugin keeps options in its existing registry instead of writing properties
  the method proxy does not expose. Initial explicit mappings are passed during
  registration. Repeated canonical `createKnexTable` ensures tables and refreshes
  metadata instead of deleting/re-registering the initial field definition set.
- Field additions compile with the existing `compileSchemas` function, retaining
  getters, setters, computed fields and serializers. New request contracts replace
  cached contracts for the prior schema. No second compiler was introduced.
- A public field batch owns one metadata transaction; options/compiled schema
  are published after successful allocation and commit. Allocation persists
  schema JSON as well as slot/relationship rows and rebuilds descriptors through
  the existing loader, removing its hand-maintained partial descriptor update.
- Borrowed registry transactions own descriptor reads as well as writes. Their
  reads/allocations/re-registration do not read or populate the global cache.
  Callers explicitly invalidate after commit; rollback cannot leak an uncommitted
  descriptor. This deep-API requirement is in the migration guide.
- Existing slot parsers reject out-of-range indices, noncanonical spellings and
  mismatched relationship ID/type slots. Computed/virtual fields have definitions
  but no allocated storage and reject explicit slot overrides.

The first corrected SQLite run passed the nine new cases and all twenty temporal
migration cases: **29/29**, no skips, 1.274 s
(`/tmp/library-field-evolution-first-fixed.log`). Selected PostgreSQL/MySQL runs
also passed with the temporal conformance file: **130 regular / 132 AnyAPI** per
database (`/tmp/library-field-evolution-first-{pg,mysql2}.log`).

Review added computed/virtual definitions, new serializer callbacks and borrowed
re-registration. The 12-case review passed 11/12: `string_01` was still accepted
even though no such column exists (`/tmp/library-field-evolution-review-before.log`).
Checking membership in the actual slot pool, and exact relationship column names,
corrected that defect. The 12 cases then passed
(`/tmp/library-field-evolution-review-fixed.log`). Final coverage also verifies
redeclared callback defaults after restart and rejects non-stored slot overrides,
for **13 permanent field-evolution cases**. Initial edit syntax/indentation was
corrected before passing focused runs; final focused lint exits 0.

Final selected runs include field evolution, the temporal migration example and
temporal conformance, with no failures/skips:

| Database | Regular invocation | AnyAPI invocation | Duration, regular / AnyAPI |
| --- | --- | --- | --- |
| SQLite | 134/134 | 135/135 | 7.204 / 6.936 s |
| PostgreSQL 16.15 | 134/134 | 136/136 | 13.884 / 14.396 s |
| MySQL 8.0.46 | 134/134 | 136/136 | 19.622 / 24.414 s |

Logs: `/tmp/library-field-evolution-final-{better-sqlite3,pg,mysql2}.log` and
`/tmp/library-field-evolution-final-lint.log`. All selected-run temporary database
directories were confirmed removed. The [coverage map](conformance.md#canonical-field-evolution)
states the fixed canonical suite's limits; repeating it in the regular invocation
does not establish regular-table DDL coverage. The default matrix now has eight
suites.

A3-05 remains open for real-driver regular public helper wiring/direct alterations
and composite foreign-key/index dependencies. Consumer repositories and seeds
remain untouched. Verified total is still **46/214 (21.5%)**,
A39/138, B5/48, M2/14, C0/14.

Final `npm run verify` passes on Node 22.16.0
(`/tmp/library-field-evolution-full-gate.log`, exit 0): **1925/1926 regular**
(49.296 s, one existing skip), **1922/1922 AnyAPI** (63.772 s),
**328/328 Express 4 per mode** (15.610/15.698 s), lint and docs (2.567 s).
There are no failures.

Final `npm run test:databases` passes **2,367 checks** in the eight-suite matrix,
with no failures or skips (`/tmp/library-field-evolution-full-matrix.log`, exit 0):

| Database | Regular invocation | AnyAPI invocation | Duration, regular / AnyAPI |
| --- | --- | --- | --- |
| SQLite | 393/393 | 392/392 | 25.650 / 36.694 s |
| PostgreSQL 16.15 | 396/396 | 396/396 | 63.328 / 40.368 s |
| MySQL 8.0.46 | 395/395 | 395/395 | 42.840 / 46.034 s |

The fixed-backend suites retain the coverage limitations stated above. Temporary
directory `/tmp/jra-db-Pm3mmB` and server PIDs 4095809/4099259 were cleaned up.
Only documentation changed after the final runtime checks. The parked consumer
patch checksum remains
`81c454022208ba2c1bc8d2a893a4e3eb9d7d5c8b09d8e86a4bf435ea9b6e2d3e`.

## 2026-09-09: existing AnyAPI temporal migration and startup guard, A3-05 in progress

Added the one-off executable example `examples/migrations/anyapi-temporal-v2.js`
and `anyapi-temporal-migration.test.js`. The example requires explicit source and
destination slots and a converter chosen for the original application's temporal
convention. It reuses the existing slot pools, raw-driver read options and public
temporal storage validation. The caller owns the data transaction; native
precision DDL is a separate, documented step. This is source migration assistance,
not a runtime compatibility layer or an online migration framework.

The initial 16-case suite passed on SQLite and PostgreSQL (both PostgreSQL
invocations). MySQL passed 14/16: two raw-snapshot expectations overlooked that
precision 3-to-6 DDL pads driver timestamp strings with three more zeros. Fixed
the expected padding without weakening checks of other column values. Initial
lint reported eight formatting/naming errors, subsequently corrected. Logs:
`/tmp/library-anyapi-migration-first-{sqlite,pg,mysql2,lint}.log`.

Review added empty-resource migration and existing-microsecond preservation.
The 18-case suite passed in both invocations on all three databases
(`/tmp/library-anyapi-migration-reviewed-{better-sqlite3,pg,mysql2}.log`). The
[coverage map](conformance.md#existing-anyapi-temporal-data-migration) details
five-table snapshot preservation, overlapping tenant IDs, relationships, fresh
API startup, both formats, filters, forward/backward cursors, nulls, multiple
batches, soft-deleted rows, conversion failures and caller rollback.

A separate fresh-start probe then found a real gap in the migration guard:
`AnyapiRegistry.registerResource` deleted/replaced old field metadata before its
descriptor loader could reject incompatible temporal slots. Starting the new
API could silently bind those fields to empty string slots. The isolated probe
`/tmp/jra-anyapi-startup-review.mjs` failed with a missing expected rejection
(`/tmp/library-anyapi-migration-startup-review.log`). Two permanent regression
cases also failed before correction: direct registration and fresh API startup
(`/tmp/library-anyapi-migration-startup-before.log`, 0/2 passed).

Registration now calls its existing descriptor loader inside the registration
transaction before changing an existing resource's metadata. Both owned and
borrowed transactions reject incompatible mappings before writes. The fresh
startup test confirms unchanged stored records, links and the affected resource's
configuration; unrelated resources may already have completed their own ordinary
registration. No new validator or registry abstraction was added.

The final focused suite has 20 cases and passes in both invocations on actual
SQLite, PostgreSQL 16.15 and MySQL 8.0.46, without failures or skips:

| Database | Regular invocation | AnyAPI invocation | Duration, regular / AnyAPI |
| --- | --- | --- | --- |
| SQLite | 20/20 | 20/20 | 0.888 / 0.990 s |
| PostgreSQL 16.15 | 20/20 | 20/20 | 3.349 / 3.557 s |
| MySQL 8.0.46 | 20/20 | 20/20 | 5.907 / 5.445 s |

Logs: `/tmp/library-anyapi-migration-startup-fixed-{better-sqlite3,pg,mysql2}.log`.
All three temporary server directories were removed. Focused lint also passes
(`/tmp/library-anyapi-migration-startup-lint.log`). This suite always uses
canonical storage; its repeated regular invocation is not regular-table evidence.

The earlier full runs named `/tmp/library-anyapi-migration-final-{gate,matrix}.log`
were deliberately interrupted after the startup probe exposed the defect and
before editing the runtime fix. The gate ended 143 and the database runner ended
1 after handling SIGTERM. These are incomplete pre-fix runs, not final passing
verification. The runner stopped PostgreSQL and removed `/tmp/jra-db-wBsDsD`.
Final `npm run verify` passes on Node 22.16.0
(`/tmp/library-anyapi-migration-guard-final-gate.log`, exit 0):

| Job | Result | Duration |
| --- | --- | --- |
| Full regular SQLite | 1912/1913 passed, zero failures, one existing skip | 61.028 s |
| Full AnyAPI SQLite | 1909/1909 passed, no failures/skips | 68.968 s |
| Express 4 regular | 328/328 passed, no failures/skips | 14.368 s |
| Express 4 AnyAPI | 328/328 passed, no failures/skips | 16.641 s |
| Lint | Passed | — |
| Documentation build | Passed | 2.575 s |

Final `npm run test:databases` passes **2,289 checks** across its seven suites,
with no failures or skips
(`/tmp/library-anyapi-migration-guard-final-matrix.log`, exit 0):

| Database | Regular invocation | AnyAPI invocation | Duration, regular / AnyAPI |
| --- | --- | --- | --- |
| SQLite | 380/380 | 379/379 | 34.213 / 38.189 s |
| PostgreSQL 16.15 | 383/383 | 383/383 | 63.869 / 44.368 s |
| MySQL 8.0.46 | 382/382 | 382/382 | 25.728 / 39.448 s |

The suite-specific regular/canonical limitations described above still apply.
The runner exited successfully, its `/tmp/jra-db-bXP4dM` directory was removed,
and no server process remained for that directory. Only prose changed after the
final runtime checks.

`npm pack --dry-run --json --ignore-scripts` also succeeds. The manifest includes
the migration example and both deep helper modules used by its documented
imports (`/tmp/library-anyapi-migration-pack.json`). This is a packaging inclusion
check, not a consumer artifact migration or a claim of final package review.

The next public-helper review has a concrete unresolved reproduction:
`/tmp/jra-anyapi-add-field-review.mjs` calls `events.addKnexFields` with one string
field and a free explicit canonical slot. It fails before allocation with
`Cannot read properties of undefined (reading 'schema')` at the scope-options
mutation in `rest-api-anyapi-knex-plugin.js`
(`/tmp/library-anyapi-add-field-review.log`, exit 1). This is the next A3-05 fix;
the passing migration suite does not cover or resolve it. Further checks must
exercise field/default persistence after cache reload, regular public schema
helpers and direct alterations, and composite foreign-key/index dependencies.
Inspection of the installed `hooked-api` proxy explains the immediate failure:
it exposes `vars`, `helpers` and methods, while scope options are supplied
separately to method handlers. Assigning `scope.scopeOptions` does not make the
property readable through that proxy. Fix this using the existing option/schema
owners, without adding a compatibility proxy.

A3-05 remains open for those schema dependencies and public/default helper
paths. The synthetic existing-temporal-data migration now has execution coverage;
actual consumer migrations remain on hold. No additional checklist item is
claimed: **46/214 complete (21.5%)**, A39/138, B5/48, M2/14, C0/14.
The parked consumer patch checksum remains
`81c454022208ba2c1bc8d2a893a4e3eb9d7d5c8b09d8e86a4bf435ea9b6e2d3e`.

## 2026-09-09: real table introspection and migrations, A3-05 in progress

This batch adds `db-schema-conformance.test.js` against actual SQLite,
PostgreSQL 16.15 and MySQL 8.0.46, using the existing disposable fixture and
runner. The table helpers explicitly operate on ordinary SQL tables, including
when invoked during the AnyAPI job. Repeated execution there does not prove
canonical schema-evolution coverage. Consumer repositories and seeds are untouched.

Initial `/tmp/library-schema-{better-sqlite3,pg,mysql2}-before.log` runs failed:
SQLite passed 1/7, PostgreSQL 1/8 and MySQL 1/8. PostgreSQL introspection was
entirely unsupported. SQLite exposed spurious alterations and missing foreign-key
replacement drops; two initial SQLite assertions incorrectly expected native
decimal precision metadata, although the installed Knex emits `float`. MySQL
also exposed lost empty defaults and precision-only diffs that emitted no change.

The existing introspection module now reads PostgreSQL catalog metadata with
bound current-schema/table names. It reuses column, index, foreign-key and check
normalization; recognizes its native types and Knex inline enum checks; and
reports snapshot shapes it cannot represent rather than turning partial indexes
into ordinary indexes. Initial PostgreSQL catalog arrays required `attname::text`
so the actual driver decoded them as arrays. The older unsupported-client test
now uses `mssql` instead of the newly supported `pg`.

Migration corrections reuse the existing desired-column model and code generator:

- Compare effective default string length and only relevant precision/scale
  metadata. Native integer/float/binary metadata and SQLite's lack of native
  decimal precision no longer cause endless unchanged-schema alterations.
- Preserve MySQL's literal defaults, including empty strings and the text `null`.
  Normalize PostgreSQL quoted constants/casts without evaluating expressions;
  distinguish actual SQL null. Compare boolean/decimal defaults by value while
  retaining the exact content of string defaults and large integer literals.
- Emit JavaScript BigInt literals in migrations. The original generated default
  `9223372036854775807n` became an imprecise number: SQLite stored a rounded real
  value, while PostgreSQL/MySQL rejected the out-of-range integer default.
- Detect native temporal precision changes and warn about reductions. Explicit
  `time(n)` declarations also correct Knex's ignored PostgreSQL time precision.
  Public TIME(3) raw-injection expectations now reflect PostgreSQL rounding at
  storage, like MySQL; public input validation is unchanged. MySQL's expanded
  time precision returns padded trailing zeros, explicitly asserted in the test.
- Drop a changed named foreign key before adding its replacement. Keep MySQL
  non-unique indexes needed by retained foreign keys. Treat implicit BTREE as
  the default index type rather than repeatedly dropping/recreating it.
- Compare check formatting without losing string-literal case. Ordinary changed
  checks remain explicitly warning-only; no duplicate named check is added.

The focused defaults review (`library-schema-*-defaults-review-before.log`)
independently exposed the BigInt defect, PostgreSQL explicit-null/enum metadata
and MySQL decimal-default comparison. A MySQL test alias named `stored` also
required identifier quoting; that was a fixture SQL correction. After fixes,
`library-schema-*-defaults-review-fixed.log` passed 12 SQLite / 14 PostgreSQL /
13 MySQL checks per invocation.

The first full gate `/tmp/library-schema-first-batch-gate.log` exits 0:
1889/1890 regular (one existing skip, 68.792 s), 1886/1886 AnyAPI (89.632 s),
328/328 Express 4 per mode (18.291/22.262 s), lint and docs (2.861 s). The first
expanded matrix `/tmp/library-schema-first-batch-matrix.log` exits 0 with 2,147
checks and no skips: SQLite 357/356 (35.827/37.537 s), PostgreSQL 359/359
(78.129/58.285 s), MySQL 358/358 (23.976/51.965 s). Its directory
`/tmp/jra-db-m7sYQj` was removed and server PIDs 4026938/4031057 stopped.

Review continued after that green gate. The isolated
`/tmp/jra-schema-review-next.mjs` probe, logged in `library-schema-*-adjacent-review.log`,
passed its object-default case on all databases. Its enum-change case failed on
SQLite (the old check still rejected the new `Admin` value) and PostgreSQL
(invalid `ALTER ... TYPE text check (...)` SQL). MySQL passed both cases in
both invocations. All probe databases/servers were cleaned up.

PostgreSQL enum diffs now alter the text column and replace the matching inline
check separately. The returned plan adds `dropCheckConstraints`, documented in
the API migration guide. SQLite changing an existing enum's allowed values
requires a table rebuild that replaces the old check; its diff reports that
limitation and retains the existing definition. This is a deliberate boundary
around the current Knex builder, not an automatic SQLite enum migration. Enum
default changes retain a single existing check. Native rejected narrowing tests
assert the original rows and constraints remain; PostgreSQL uses the caller's
transaction to roll back the attempted check replacement. These cases do not
establish general MySQL transactional DDL semantics.

The permanent suite now has 15 SQLite / 18 PostgreSQL / 17 MySQL cases per
invocation. `/tmp/library-schema-*-enum-review-fixed.log` passes all of them,
without skips. Regular/AnyAPI invocation durations: SQLite 0.304/0.278 s,
PostgreSQL 0.996/1.006 s, MySQL 1.675/1.617 s. The suite includes direct and
generated creation, stored defaults and mappings, additive/precision migrations,
enum/check behavior, failed narrowing, foreign-key replacement, and empty second
diffs.

Final `npm run verify` passes on Node 22.16.0
(`/tmp/library-schema-enum-final-gate.log`, exit 0):

| Job | Result | Duration |
| --- | --- | --- |
| Full regular SQLite | 1892/1893 passed, zero failures, one existing skip | 56.430 s |
| Full AnyAPI SQLite | 1889/1889 passed, no failures/skips | 70.696 s |
| Express 4 regular | 328/328 passed, no failures/skips | 15.503 s |
| Express 4 AnyAPI | 328/328 passed, no failures/skips | 16.468 s |
| Lint | Passed | — |
| Documentation build | Passed | 1.932 s |

Final `npm run test:databases` passes all **2,169 checks**, with no failures or
skips (`/tmp/library-schema-enum-final-matrix.log`, exit 0):

| Database | Regular | AnyAPI invocation | Duration, regular / AnyAPI |
| --- | --- | --- | --- |
| SQLite | 360/360 | 359/359 | 28.892 / 34.295 s |
| PostgreSQL 16.15 | 363/363 | 363/363 | 61.361 / 45.566 s |
| MySQL 8.0.46 | 362/362 | 362/362 | 22.841 / 39.313 s |

The six-suite matrix includes the ordinary-table helper cases described above;
their repetition in the AnyAPI invocation is not canonical migration coverage.
Temporary directory `/tmp/jra-db-rkGRNH` was removed and server PIDs
4043921/4047007 were confirmed stopped. Only documentation changed after these
final runtime checks.

A3-05 remains open: canonical existing-data migration, broader dependency/schema
changes and additional public/default paths still need execution coverage. No
new checklist item is claimed by this partial batch. Verified total remains
**46/214 (21.5%)**, A39/138, B5/48, M2/14, C0/14. The parked migration checksum
remains `81c454022208ba2c1bc8d2a893a4e3eb9d7d5c8b09d8e86a4bf435ea9b6e2d3e`.

## 2026-09-09: real-driver temporal values and projection review

Completed A3-03 on actual SQLite, PostgreSQL 16.15 and MySQL 8.0.46 in both
storage modes with Node 22.16.0. Consumer repositories and seeds remain on hold.
The earlier temporal driver failures below are historical; the final expanded
matrix passes. Full schema/migration execution and driver conformance remain
separate open requirements.

The implementation extends existing normalization, storage, query and schema
helpers rather than adding a second conversion system:

- Library reads request raw temporal strings per query. PostgreSQL's date,
  timestamp and timestamptz text parsers and MySQL's `dateStrings` option avoid
  premature timezone conversion or loss of microseconds. Other PostgreSQL types
  delegate to the configured/default parser. Caller Knex queries retain their
  native results; supplied configuration and global parser registries are not
  changed. Get, minimal get, query, related and standard/window include paths
  are covered.
- Built-in native writes and comparisons bind explicit UTC representations,
  including PostgreSQL year 0000 as 1 BC. Reads handle PostgreSQL offsets with
  seconds, including the historical Perth offset, and retain significant
  fractional digits. MySQL's documented native year range rejects earlier
  dates before writes for all return modes. Custom serializers retain their
  existing metadata contract and handle declared finer timestamp precision.
- Equivalent time spellings normalize before writes and filters. Public times
  always include seconds; explicit precision pads digits, while unspecified
  precision removes redundant trailing zeros. Native SQL times reject precision
  beyond six meaningful digits; SQLite and AnyAPI text time slots can retain
  finer values. Datetimes keep at least milliseconds unless a smaller declared
  precision limits them, and discard redundant digits beyond milliseconds.
- New native dateTime/time columns and generated migration declarations default
  to precision 6. This fixes actual MySQL rounding into the following day and
  loss of default time fractions. AnyAPI calendar dates and times use string
  slots; dateTime slots use native precision 6. Explicit startup guards reject
  persisted incompatible slot metadata and canonical column precision. These
  guards do not alter existing data or replace a migration.

`conformance-temporal` now has **101 regular cases** per database, **102 SQLite
AnyAPI cases** and **103 PostgreSQL/MySQL AnyAPI cases**. The extra canonical
cases exercise stored-metadata and native-column migration guards. Ten direct
normalizer cases are explicitly distinguished from database assertions. Public
coverage includes both formats, POST/PUT/PATCH and all return modes, calendar
year zero, offsets, time spellings/precision, zero/negative/unsafe epochs,
BigInt/native values, booleans, nulls, setters/getters/computed fields, scalar
and array filters, custom serializer context/failure, complete cursors and
standard/window includes with full and sparse fields.

The SQL inspection assertions identify each driver's actual storage and
rejection behavior. Invalid native SQL values can be rejected by the database
before the library reads them; those cases assert the specific driver error and
unchanged persisted null. MySQL TIME(3) rounds excess raw SQL input while SQLite
and PostgreSQL read-boundary cases follow their declared expectations. These
differences are explicit, not accepted as arbitrary success/failure.

Useful before/after evidence, all logs under `/tmp`:

- `library-temporal-{pg,mysql}-read-write-first.log`: 46/64 PostgreSQL and
  40/64 MySQL regular passed after the first conversion changes; remaining
  native storage, fixture and representation problems were still open.
- `library-temporal-*-defaults-before.log`: SQLite 89 regular / 90 AnyAPI
  passed. PostgreSQL and MySQL regular each passed 85/89; four failures exposed
  short PostgreSQL fractions and MySQL's default precision loss/rounding.
- `library-temporal-full-gate.log` and `library-temporal-full-matrix.log`:
  the first complete gate and 2,021-check database matrix both exited 0.
  Subsequent review still found projected-date repetition on AnyAPI SQLite
  and precise projected timestamps bypassing their custom serializer.
- `library-temporal-projection-review-before.log`: an isolated four-case
  reproduction passed only one case. The two defects were corrected by reusing
  `serializeFieldValueForStorage` in the existing query projection predicate
  helper and carrying the canonical text-storage choice in projection metadata.
  No cursor format or new callback API was introduced. Six permanent tests
  cover date/time/custom timestamp projections in both formats, tied values,
  null boundaries, sparse output, forward/backward traversal and callback details.
- `library-temporal-{pg,mysql}-projections-fixed.log`: 99 regular / 101 AnyAPI
  passed on each native database. SQLite's equivalent log passed 103/104,
  including four temporary reproduction checks beyond its 99/100 shared checks.
  Two final public calendar-year-zero cases were added to the permanent suite
  and are included in the final results below.

Test-harness corrections were kept separate from runtime fixes: terminal pages
omit the cursor object, null cursor values use the existing `createCursor`
encoding, and POST verification finds its uniquely named row rather than
assuming the largest textual AnyAPI ID was most recently inserted. Raw
PostgreSQL fixture timestamps and serializers now include their intended UTC
offset. The existing array-filter schema selection already worked; no speculative
priority change was made to it.

Final `npm run verify`, `/tmp/library-temporal-final-gate.log`, exits **0**:

| Stage | Passed / total | Skips | Duration |
| --- | ---: | ---: | ---: |
| Regular full suite | 1877/1878 | 1 existing | 44.579 s |
| AnyAPI full suite | 1874/1874 | 0 | 50.777 s |
| Express 4, regular | 328/328 | 0 | 11.165 s |
| Express 4, AnyAPI | 328/328 | 0 | 12.765 s |
| Lint and documentation | Both passed | — | Docs 2.257 s |

Final `npm run test:databases`, `/tmp/library-temporal-final-matrix.log`, exits
**0**. The default selection now includes environment, IDs, queries, include
limits and temporal conformance; explicit file selection still replaces it.

| Actual database | Regular | AnyAPI | Durations, regular / AnyAPI |
| --- | ---: | ---: | --- |
| SQLite | 345/345 | 344/344 | 17.856 / 29.478 s |
| PostgreSQL 16.15 | 345/345 | 345/345 | 46.040 / 38.481 s |
| MySQL 8.0.46 | 345/345 | 345/345 | 42.511 / 48.227 s |

All **2,069 checks pass without skips**. The runner removed
`/tmp/jra-db-LkiD8P`; server PIDs 3989428/3991849 were confirmed stopped. The
first green matrix's directory and both server processes were also cleaned up.

The migration and projection guides document the public shapes, limits and
existing serializer callback. Existing-data AnyAPI migration requirements include
backup, slot allocation/copying, metadata updates, native column precision and
post-migration assertions. Execution against existing data remains A3-05;
the guide and rejection guards are not a completed migration tool. A3-02,
A3-05, A3-06, A3-12 and A2-16 remain open. The parked patch checksum remains
`81c454022208ba2c1bc8d2a893a4e3eb9d7d5c8b09d8e86a4bf435ea9b6e2d3e`.
Verified goal total: **46/214 (21.5%)**, A39/138, B5/48, M2/14, C0/14.

## 2026-09-09: real-driver query and ID contracts

Completed A3-04 on SQLite, PostgreSQL 16.15 and MySQL 8.0.46, with both regular
and AnyAPI storage. Node 22.16.0 was used throughout. No consumer source or seed
was changed. The preceding four-file driver failures remain useful historical
baselines; their temporal failures are still open under A3-03.

The runtime correction extends existing query-sort helpers. PostgreSQL DISTINCT
requires the ORDER BY value to be selected. Native `NULLS FIRST/LAST` orders the
selected column directly; projected fields use their existing selected alias.
The alias also avoids PostgreSQL treating copies of a bound expression as
different expressions because their parameter numbers differ. Both storage
plugins reuse the column helper. SQLite/MySQL retain their null test followed
by actual value ordering. No cursor format or compatibility wrapper was added.

Fixture corrections preserve explicit contracts:

- Physical foreign-key type assertions name the actual SQLite/PostgreSQL/MySQL
  types rather than assuming all drivers report SQLite's names.
- The authored display projection uses MySQL `concat` and SQLite/PostgreSQL
  `||`, with identifiers and values still bound through Knex.
- LIKE expectations follow the explicitly configured database/collation: SQLite
  ASCII-insensitive LIKE versus PostgreSQL and MySQL `utf8mb4_bin` case-sensitive
  matching. The public guide documents this SQL behavior; no filter is silently
  converted to lowercase.
- A projection-write test uses an explicit ID like its seed records. Separate
  generated-ID tests exercise actual server allocation without relying on an
  explicit PostgreSQL seed advancing the sequence. The migration guide explains
  that seed/import sequence synchronization belongs to that workflow.

Six generated mapped-ID cases cover both formats and none/minimal/full writes,
unique returned/persisted IDs, false/zero attributes and related membership.
Four DISTINCT projection cases use a bound nullable expression, duplicate sort
values, ascending/descending order, sparse fields, offset totals, and complete
forward/backward cursor traversal. An initial new test passed a descending sort
token to `createCursor`, which takes field names; fixing that test removed two
failures in each initial 165-case job. No production change was made for that
test-helper mistake.

Focused ID/query logs `/tmp/library-database-query-id-{sqlite,pg,mysql}-fixed.log`
all exit 0 with **165/165 regular** and **163/163 AnyAPI**, no failures/skips.
Regular/AnyAPI durations: SQLite 14.924/19.441 s, PostgreSQL 26.885/22.503 s,
MySQL 27.884/19.831 s.

`npm run test:databases` now defaults to the environment, ID, query and
include-limit suites. `/tmp/library-database-query-id-full-matrix.log` exits 0:

| Actual database | Regular | AnyAPI | Durations, regular / AnyAPI |
| --- | ---: | ---: | --- |
| SQLite | 244/244 | 242/242 | 30.968 / 43.988 s |
| PostgreSQL 16.15 | 244/244 | 242/242 | 73.542 / 66.587 s |
| MySQL 8.0.46 | 244/244 | 242/242 | 23.920 / 36.542 s |

All **1,458 checks** pass without skips. Each fixture uses the requested driver;
the two extra regular tests exercise pivot-resource hooks absent from canonical
storage. The matrix also executes mapped/limited includes, qualified relationship
joins, parameter bindings and counted pagination. Its directory
`/tmp/jra-db-vbT4uR` was removed and server PIDs 3935529/3939603 were confirmed
stopped after the command completed.

`/tmp/library-database-query-id-full-gate.log` records the full test stages:
**1840/1841 regular** (one existing skip, 77.480 s), **1836/1836 AnyAPI**
(104.750 s), and **328/328 Express 4** per mode (18.646/18.433 s). They all
passed. The enclosing verify command exited 1 at two formatting lint errors in
the expanded runner's default-file ternary. After the formatting-only correction,
`npm run lint` exited 0 (`/tmp/library-database-query-id-lint-closeout.log`).
The test stages were not repeated for that whitespace-only change. The separate
`npm run docs` closeout also exited 0 (initial build 1.828 s;
`/tmp/library-database-query-id-docs-closeout.log`). `git diff --check` passes.

The temporal driver baseline still fails; schema/introspection, concurrency,
remaining capability coverage and CI are unfinished. A3-02, A3-03, A3-05,
A3-06 and A2-16 remain open. The parked migration checksum remains
`81c454022208ba2c1bc8d2a893a4e3eb9d7d5c8b09d8e86a4bf435ea9b6e2d3e`.
Verified goal total: **45/214 (21.0%)**, A38/138, B5/48, M2/14, C0/14.

## 2026-09-09: disposable real databases and canonical startup fixes

Completed A3-01. The [runner and setup guide](real-databases.md) provide isolated
SQLite/PostgreSQL/MySQL jobs without changing system services or consumer code.
Server packages were downloaded/extracted to a temporary directory. Node
22.16.0, `pg` 8.23.0 and `mysql2` 3.24.4 ran PostgreSQL 16.15 and actual MySQL
8.0.46; the installed MariaDB server was not used as a substitute.

The shared fixture now delegates connection ownership to `createTestDatabase`.
It uses a random database per real-server fixture, retains SQLite as the default,
and closes/drops its database after initialization failure or normal teardown.
Explicit `knexConfig` overrides remain available for driver-specific fixtures.

Initial executed failures were distinguished from harness mistakes:

- `/tmp/library-database-pg-environment-before.log`: regular 3/3; AnyAPI 1/3.
  Registry registration destructured a PostgreSQL INSERT result without requesting
  returned IDs. The existing registry insert now requests `id` and handles the
  object/scalar results used by the three drivers.
- Repeated canonical setup attempted a duplicate unique index because Knex has no
  `schema.hasIndex` method and the old optional call always returned undefined.
  `hasKnexTableIndex` extends the existing introspection module with bound catalog
  lookups. Repeated setup inside a borrowed PostgreSQL transaction now succeeds
  without a duplicate-index error aborting that transaction.
- `/tmp/library-database-mysql-environment-before.log`: server setup initially
  required overriding Ubuntu's unavailable default `secure-file-priv` directory;
  the isolated runner disables file import/export. The next run exposed a test
  metadata query using Knex `whereLike` with the wrong MySQL collation. The
  metadata-only test uses ordinary SQL LIKE; no public filter assertion changed.
- `/tmp/library-database-mysql-environment-fixture-fixed.log`: canonical schema
  creation failed on signed foreign keys referencing unsigned metadata IDs.
  Those two columns now match the existing generated ID type. The subsequent
  `/tmp/library-database-environments-final.log` exposed an overlong generated
  relationship index name; its explicit replacement fits both server limits.
- Initial cleanup tests inherited `NODE_TEST_CONTEXT`, causing Node to skip their
  child suites. The runner now removes that variable. The tests require an
  injected failure or observed live-fixture marker, so the false pass was detected.

Final environment evidence, all exit 0:

| Command/log | Actual checks | Results |
| --- | --- | --- |
| `npm run test:databases`; `/tmp/library-database-environments-complete.log` | Identity, two-fixture isolation/reset/teardown, failed API setup cleanup, canonical unique-index restoration/enforcement and borrowed schema setup | 4/4 per mode on all three databases, 24 total; 0 failures/skips |
| `node --test tests/database-runner.test.js`; `/tmp/library-database-runner-sqlite-fixed.log` | Injected failure, SIGINT, SIGTERM and absent binary | 4/4, 3.866 s |
| Same file with `JSON_REST_API_RUNNER_DATABASE=pg`; `/tmp/library-database-runner-pg-fixed.log` | Same checks with actual PostgreSQL, including stopped server PID | 4/4, 8.873 s |
| Same file with `JSON_REST_API_RUNNER_DATABASE=mysql2`; `/tmp/library-database-runner-mysql-fixed.log` | Same checks with actual MySQL, including stopped server PID | 4/4, 43.173 s |

Per-mode environment durations were SQLite 0.987/1.151 s, PostgreSQL
2.205/2.616 s, MySQL 2.680/5.930 s (excluding server initialization). The successful
matrix's directory removal and both terminated server PIDs were also inspected.

The full Node 22.16.0 gate passes, exit 0:
`/tmp/library-database-environment-full-gate.log` has **1830/1831 regular** (one
existing skip, 36.853 s), **1826/1826 AnyAPI** (57.132 s), **328/328 Express 4**
in each mode (12.811/19.407 s), lint and docs (5.788 s).

The next driver work has actual failing baselines. Running `conformance-ids`,
`conformance-include-limits`, `conformance-queries` and `conformance-temporal`
through the runner produced PostgreSQL regular **256/294**, 38 failures
(35.117 s), and MySQL regular **257/294**, 37 failures (40.258 s). Logs:
`/tmp/library-database-{pg,mysql}-conformance-first.log`. Both exit 1 without
skips; their fail-fast behavior means AnyAPI was not executed by those commands.
Observed categories, still requiring fixes/reconciliation under A3-02–A3-06:

- Driver type names differ (`character varying`/`varchar`, `int`/`integer`), and
  test projection SQL uses SQLite/PostgreSQL string concatenation on MySQL.
- Search expectations assume SQLite LIKE case behavior. PostgreSQL DISTINCT
  queries reject the null-ordering expression missing from the selected columns.
- Explicit fixture seed IDs do not advance PostgreSQL's generated-ID sequence.
- Temporal results expose date/time-zone shifts, precision loss and repeated
  cursor rows. Some storage-injection cases assume SQLite permits values that
  typed PostgreSQL/MySQL columns reject. These need distinct assertions for
  public contracts, driver capabilities and invalid raw storage; they are not
  grounds for weakening public behavior checks.

The focused include-limit follow-up reached both storage modes and passed all
**75/75** cases in every real-server combination (300 cases total). PostgreSQL
regular/AnyAPI took 19.635/28.080 s, MySQL 23.797/33.119 s, with no failures/skips.
Logs: `/tmp/library-database-pg-include-limits.log` and
`/tmp/library-database-mysql-include-limits.log`, both exit 0. These execute the
actual mapped/projected/reference ordering, global/per-parent limits, duplicate
memberships, borrowed transactions and HTTP assertions introduced in the previous
batch. No public assertion was changed to obtain these real-driver results.

The whole-codebase gate is green on SQLite; comprehensive real-driver conformance
is not green. Consumer sources/seeds remain untouched and the parked patch
checksum remains `81c454022208ba2c1bc8d2a893a4e3eb9d7d5c8b09d8e86a4bf435ea9b6e2d3e`.
Verified goal total: **44/214 (20.6%)**, A37/138, B5/48, M2/14, C0/14.

## 2026-09-09: collection include limits and authorization reconciliation

Library-only work continues. The initial shared include-limit suite failed all
24 cases on both backends. Regular window SQL used unmapped field names, reverse
polymorphic includes used the global path, and sparse projections disabled the
per-parent path. AnyAPI ignored limits/order and retained full linkage despite
the requested subset. Logs: `/tmp/library-include-limits-{knex,anyapi}-before.log`.

The existing window-query module now contains one `applyIncludeQueryConfig`
helper. It orders already-filtered target selections, binds mapped identifiers
and projection expressions, retains parent grouping through window ranking,
uses reference visibility for relationship sort keys, and removes temporary
columns before serialization. Regular collection loaders share their repeated
selection/filtering sequence; AnyAPI uses the same limit helper. Its canonical
forward/inverse link SQL is also reused by related-ID queries. No per-parent API
loop or compatibility wrapper was introduced.

The first fix passed all 24 cases per mode (2.118/3.710 s). Adding global-limit
cases exposed a review defect: joining shared targets before a global limit counted
associations instead of unique targets. The 24-case global subset passed 20/24
per mode (`/tmp/library-include-global-*-before.log`). Global many-to-many
selection now limits unique visible targets and then retains each selected
parent's membership; window selection ranks distinct memberships per parent.
The initial 48-case matrix plus eight existing suites passed **319/319 per
invocation** (14.383/16.135 s), logs `/tmp/library-include-limits-*-focused.log`.
Some historical suites in that command still hardwire regular storage; the new
shared suite uses the requested backend throughout.

Further review executes projected ordering expressions, duplicate physical links,
borrowed transaction visibility, zero/null limits beyond the default, real HTTP
selection and hidden-reference ordering. All **75/75 shared cases pass per backend**:
`/tmp/library-include-limits-knex-expanded.log` (6.629 s),
`/tmp/library-include-limits-anyapi-expanded.log` (9.306 s). Six cases use real
Express/Fastify; Express 4 selects three. Target default sort fields are included
in selection preparation as well as ordering. The full gate below includes that
final adjustment and the expanded focused commands.

The [coverage reconciliation](conformance.md#a2-10-authorization-coverage-reconciliation)
maps A2-10's primary/include/linkage/count/pagination/bulk/representation criteria
to the shared and real-connector suites, including prior filter, cursor and
notification regressions. The final Node 22.16.0 `npm run verify` gate passed,
exit 0, log `/tmp/library-include-limits-full-gate.log`:

| Job | Result | Duration |
| --- | --- | --- |
| Full regular SQLite | 1826/1827 passed, zero failures, one existing skip | 45.868 s |
| Full AnyAPI SQLite | 1822/1822 passed, no failures/skips | 53.565 s |
| Express 4 regular | 328/328 passed | 10.925 s |
| Express 4 AnyAPI | 328/328 passed | 10.854 s |
| Lint | Passed | — |
| Documentation | Passed | 2.111 s |

A2-10 is now checked. Verified total: **43/214 (20.1%)**,
A36/138, B5/48, M2/14, C0/14. Only evidence prose changed after this gate.
`git diff --check` passed and the parked migration checksum is unchanged.
Real PostgreSQL/MySQL, remaining configuration/capability work, general transaction
outcomes, migrations and Part C remain separate unfinished requirements.
Consumers and their seeds were untouched. The guide records the removed internal
query-helper exports and observable include changes for later migration.

## 2026-09-09: reference sorting and cursor visibility

Library-only execution continues. Verified checklist completion remains
**42/214 (19.6%)**, A35/138, B5/48, M2/14, C0/14. Consumers, their seeds and the
parked migration remain unchanged. This batch addresses the cursor defect
reported by the preceding reference-filter audit; broader A2-10 work stays open.

The initial 26-case sort suite passed only 2/26 on each backend, reproducing
hidden keys in sorting/cursors, incorrect hidden/null ordering and missing target
permission checks. Logs: `/tmp/library-reference-sorting-knex-before.log`
(3.246 s), `/tmp/library-reference-sorting-anyapi-before.log` (3.950 s).
The shared query helper now reuses reference visibility and target filtering to
LEFT JOIN a filtered source-row lookup. That lookup exposes the original column
only when the target is visible; otherwise its joined value is NULL. Keeping a
column, rather than a CASE/scalar expression, preserves SQLite affinity and
collation. Each sorter uses that column for ordering and cursor predicates and
reads the same value for cursor metadata/links. Temporary selected values are
removed before response transformation and relationship loading.

The first fixed runs passed 26/26 per backend (4.086/5.208 s). Review expanded
to 54 tests per invocation, including fourteen real HTTP cases, self references,
combined type/ID sorts, filters/includes, caller/transaction changes and two
explicit regular NOCASE tests. The first expansion passed 52/54 per invocation
because two HTTP assertions incorrectly expected a programmatic error `code`
on the wire. Those assertions now check the existing 403/detail contract.

A stronger collision case then reproduced public attributes/query projections
being overwritten or removed when their names matched temporary sort values:
0/2 passed per backend in `/tmp/library-reference-sort-alias-*-before.log`.
Temporary result names now avoid schema fields, translated storage columns,
query projections and sort-field names. The expanded fixed suite passes 54/54
per invocation: `/tmp/library-reference-sorting-knex-expanded-fixed.log`
(6.254 s), `/tmp/library-reference-sorting-anyapi-expanded-fixed.log` (8.024 s).

Two further cases exercise conflicting source/target IDs across resources and,
on AnyAPI, inserted canonical rows in another tenant/resource. The 38-case
programmatic subset passes on both modes (4.668/5.865 s), logs
`/tmp/library-reference-sort-isolation-{knex,anyapi}.log`. The final file contains
54 selected-backend cases plus two fixed regular collation cases. Focused query,
authorization and connector commands include it; Express 4 selects seven cases.

The migration/row-policy guides describe visible reference sorts, null ties,
`defaultSort`, cursor restarts and the existing `search-join` policy boundary.
The complete `npm run verify` gate passed on Node 22.16.0, exit 0, log
`/tmp/library-reference-sorting-full-gate.log`:

| Job | Result | Duration |
| --- | --- | --- |
| Full regular SQLite | 1751/1752 passed, zero failures, one existing skip | 55.300 s |
| Full AnyAPI SQLite | 1747/1747 passed, no failures/skips | 70.993 s |
| Express 4 regular | 325/325 passed | 17.687 s |
| Express 4 AnyAPI | 325/325 passed | 18.453 s |
| Lint | Passed | — |
| Documentation | Passed | 4.769 s |

The complete gate executes all 56 reference-sort cases in each full invocation.
The two fixed collation cases remain regular SQLite even in the AnyAPI job;
previously disclosed backend-fixed tests and mode-specific suite exclusions
still limit the full-suite matrix. `git diff --check` passed and the migration
archive checksum remains unchanged. Only evidence prose changed after this gate.
Required real-driver, remaining include-limit, transaction/notification, migration
and Part C work is still open; these checks do not establish whole-goal completion.

## 2026-09-09: direct reference visibility and typed filter links

Library-only execution continues; the count remains **42/214 (19.6%)**,
A35/138, B5/48, M2/14, C0/14. Consumer repositories/seeds and the parked migration
are unchanged. A2-10 is still open for the cursor issue described below.

Twenty new cases per backend reproduced direct-reference inference: matching a
foreign key, relationship alias, polymorphic ID/type, or reference on a joined
target disclosed rows despite null response linkage. The first runs passed 44/64
(`/tmp/library-reference-filters-knex-before.log`,
`/tmp/library-reference-filters-anyapi-before.log`). Existing filter hooks now
resolve declared reference columns through the target query/filter boundary.
The existing operator helper evaluates the original column when its reference is
visible and SQL NULL otherwise, preserving OR grouping and SQL null behavior.
Visibility is request-local and uses the caller's transaction; no data normalizer,
new adapter proxy or per-record API lookup was added.

A CASE-expression prototype first produced invalid double-parenthesized EXISTS
SQL (46/64 passed), then exposed SQLite's loss of column affinity (regular 54/64,
AnyAPI 64/64). A scalar-subquery prototype passed all 64 shared cases but an
independent SQLite probe showed it lost NOCASE collation. The final predicate
branches compare the original column directly; the permanent collation fixture
uses a real NOCASE reference column. These failed/discarded prototypes are not
recorded as final passing evidence.

The expanded suite also found generated pagination links dropping null filters,
so the next page selected a different collection. The shared parser/serializer
now uses `filter[field][json]` for explicit typed values. Nulls, arrays (including
empty arrays and strings containing commas), and objects survive link round trips.
Ordinary filter strings remain strings; malformed typed JSON is a client error.
The API migration guide documents examples rather than requiring caller shims.

Early expanded runs contained two test setup mistakes: a newly seeded self-link
correctly failed cross-workspace write validation, and cursor tests assumed an
offset-style `prev` link. The self-link test now uses the established adversarial
storage-fixture pattern, and backward cursor traversal uses the documented
`before` boundary. The null-filter link loss was a runtime defect, separately
fixed. The focused final run passes **99/99 per invocation**: 90 selected-backend
search cases, one explicit regular collation case and eight shared parser cases.
Logs: `/tmp/library-reference-filters-knex-final.log` (8.185 s) and
`/tmp/library-reference-filters-anyapi-final.log` (10.033 s). Twenty-eight search
cases use real HTTP; Express 4 selects fourteen of them.

The first full gate passed on Node 22.16.0, exit 0
(`/tmp/library-reference-filters-full-gate.log`): regular 1695/1696 with one
existing skip, AnyAPI 1691/1691, Express 4 318/318 per mode, lint and docs.
Subsequent error-source review found malformed typed queries used a document
pointer for a URL parameter. Two HTTP cases per backend reproduced that defect
(`/tmp/library-reference-query-source-*-before.log`). The existing payload error
and shared HTTP mapper now support `source.parameter`; the parser supplies the
actual query key. Both focused HTTP cases pass per backend. The reviewed full
gate below validates that final change too.

The final reviewed `npm run verify` passed on Node 22.16.0, exit 0
(`/tmp/library-reference-filters-reviewed-gate.log`):

| Job | Result | Duration |
| --- | --- | --- |
| Full regular SQLite | 1695/1696 passed, zero failures, one existing skip | 45.269 s |
| Full AnyAPI SQLite | 1691/1691 passed, no failures/skips | 56.951 s |
| Express 4 regular | 318/318 passed | 12.479 s |
| Express 4 AnyAPI | 318/318 passed | 12.553 s |
| Lint | Passed | — |
| Documentation | Passed | 2.199 s |

`git diff --check` passed. The parked migration SHA-256 is unchanged:
`81c454022208ba2c1bc8d2a893a4e3eb9d7d5c8b09d8e86a4bf435ea9b6e2d3e`.
Only evidence prose changed after the final gate; no consumer checks were run.

The follow-up audit reproduces hidden reference IDs in cursor values when an
application explicitly makes the backing key sortable. Both modes return null
linkage but a cursor such as `group_id:1,id:2`, including the hidden group ID
(`/tmp/library-reference-sort-inspection.log`). A2-10 cannot close until sort
values, cursor comparison and serialization enforce a consistent visibility
contract. Real drivers, include-limit parity, transaction/notification outcomes,
consumer migration and Part C also remain open.

## 2026-09-09: search-join visibility, polymorphic paths and canonical IDs

Library-only work continues. The verified checklist remains **42/214 (19.6%)**,
A35/138, B5/48, M2/14, C0/14. Consumer repositories/seeds and the parked migration
remain unchanged. This batch strengthens A2-10; it does not close Part C.

The first permanent search suite failed 20/22 regular cases
(`/tmp/library-search-authorization-before.log`): hidden related fields matched
primary rows/counts, and mapped polymorphic targets used the wrong table. The
existing query helpers now build joined selections through each target's storage
adapter and `applyQueryFilters`, using target query permission and
`queryPurpose: 'search-join'`. Predicates run inside LEFT JOIN sources, preserving
independent primary OR matches and absent related rows. Every intermediate path
receives the caller's authorization and transaction context. No new adapter proxy,
query framework or per-row GET permission checks were introduced.

Regular storage then passed 22/22. AnyAPI's first run failed all 22 during setup:
scalar `type: 'id'` fields had never received slots. Allocating those fields
revealed a second defect: numeric IDs bound to SQLite TEXT became `"1.0"` and
failed to match logical IDs. Existing canonical write/filter conversion now binds
these IDs as strings. ID fields are appended after previously allocated ordinary
fields; the regression checks unchanged ordinary/primary slots, descriptor reload,
re-registration and stored values. This is not a general schema-evolution solution.
The first allocation-only run passed 18/22; string binding made all 22 pass.
Logs: `/tmp/library-search-authorization-anyapi.log`,
`/tmp/library-search-authorization-anyapi-id-fix.log`,
`/tmp/library-poly-search-inspection.log`,
`/tmp/library-search-authorization-anyapi-binding.log`.

Review added response and combined-filter assertions. They reproduced AnyAPI
returning foreign-key/type attributes after hidden linkage was nulled, and both
backends omitting nested joins when a direct polymorphic filter appeared first.
The canonical decoder now removes relationship backing attributes, matching the
regular decoder. Polymorphic path construction deduplicates individual joins while
processing every requested path. Sparse/plain responses and both filter argument
orders are covered. Early review runs also contained test mistakes (array sparse
fields, an omitted explicit count page, zero for a positive ID attribute, and an
assumption that an existing numeric primary slot should disappear). Those were
corrected to the existing contract, not treated as runtime regressions.

The expanded suite passes **44/44 per backend**, including 12 real HTTP requests,
borrowed transaction rollback, distinct reverse-join counts and canonical slot
persistence. Logs: `/tmp/library-search-expanded-knex-final.log` (4.718 s) and
`/tmp/library-search-anyapi-slot-final.log` (6.027 s). The focused command groups
now include this suite, with six Express cases selected for Express 4. The API
migration and row-policy guides explain the behavior and the new query purpose.

The complete `npm run verify` gate passed on Node 22.16.0, exit 0
(`/tmp/library-search-visibility-full-gate.log`):

| Job | Result | Duration |
| --- | --- | --- |
| Full regular SQLite | 1646/1647 passed, zero failures, one existing skip | 39.912 s |
| Full AnyAPI SQLite | 1642/1642 passed, no failures/skips | 45.840 s |
| Express 4 regular | 310/310 passed | 9.287 s |
| Express 4 AnyAPI | 310/310 passed | 11.477 s |
| Lint | Passed | — |
| Documentation | Passed | 2.111 s |

`git diff --check` passed, and the parked patch SHA-256 remains
`81c454022208ba2c1bc8d2a893a4e3eb9d7d5c8b09d8e86a4bf435ea9b6e2d3e`.
Only evidence prose changed after this gate; no consumer check was run.

A further inspection confirms that an explicitly enabled filter on a polymorphic
backing ID can still match the stored reference despite null response linkage
(`/tmp/library-direct-reference-search-inspection.log`, both modes). The next
A2-10 batch must resolve this remaining inference path, with permanent assertions
and consistent behavior for ordinary and polymorphic reference filters. Passing
joined-attribute tests do not establish that separate path. Real drivers, full
include-limit parity, transaction/notification outcomes and other master items
remain open.

## 2026-09-09: include permissions, pivot policies and plain include graphs

This batch fixes three verified defects while keeping all work in this repository.
The completed-item count remains **42/214 (19.6%)**, A35/138, B5/48, M2/14,
C0/14. A2-10 remains open: the next search-join audit has reproduced a separate
visibility leak, described below. Consumer checkouts, seeds and the saved migration
are untouched.

Included targets and relationship identifiers applied row filters but bypassed
target `query` permission. The first 40-case regression run failed 37 cases with
missing expected rejections (`/tmp/library-include-permissions-before.log`). The
three passing cases were the already-protected to-many related query path.
`apply-query-filters.js` now checks query permission for include/identifier reads,
using target method/scope/schema, caller auth/transaction, no parent ID, and no
inherited parent filters. It then runs existing row filters. Explicit denials
reject the read; hidden rows retain the established filtering/null behavior.
No per-record GET lifecycle or permission cache was introduced.

Regular many-to-many includes also read pivot rows without applying pivot policies
or permissions. Twelve cases first failed in
`/tmp/library-pivot-include-before.log`. The existing scoped filtering helper now
covers pivot discovery, the pivot side of the window query, and default linkage.
Predicates precede limits and use mapped columns/aliases. The full-linkage and
count tests initially needed an explicit page request to produce pagination meta;
that was a new test setup error, corrected without changing pagination behavior.
These are regular-pivot tests: AnyAPI canonical links do not inherit a declared
pivot resource's policy.

Nested include assertions then reproduced a plain-conversion defect on both
backends: the included array was discarded after one level, and nested schema
lookup used a nonexistent property. JSON:API carried the publisher/country while
plain output lost them (`/tmp/library-nested-plain-inspection.log`). The first
combined gate failed those two new plain assertions, with 1595/1598 passes, two
failures and one existing skip (`/tmp/library-include-pivot-full-gate.log`). This
is recorded as a failed gate, not passing evidence.

The existing `transformSingleJsonApiToSimplified` now traverses available included
records and retains leaf identifiers, with a path-local ancestor set terminating
cycles. It expands repeated siblings independently and retains nonincluded members
of partially expanded to-many linkage. Duplicate to-one/to-many expansion branches
were removed. The separate value normalizer remains responsible for field types;
no new normalization function or compatibility layer was added.

The expanded permission suite passes **84/84 per invocation**, comprising 72 cases
on the selected backend plus twelve explicit regular-pivot cases. It includes all
six relationship shapes, both formats, 24 real HTTP cases, third-level includes,
query metadata/borrowed transaction identity, and write response permission/rollback.
Logs: `/tmp/library-include-plain-knex.log` (3.430 s) and
`/tmp/library-include-plain-anyapi.log` (4.017 s). Five direct graph tests also pass
(`/tmp/library-plain-graph-tests.log`). Commands select the new suites in the
complete gate; authorization/connector commands include the permission suite, and
Express 4 selects its twelve HTTP cases.

The final expanded `npm run verify` gate passed on Node 22.16.0, exit 0, log
`/tmp/library-include-plain-full-gate.log`:

| Job | Result | Duration |
| --- | --- | --- |
| Full regular SQLite | 1602/1603 passed, zero failures, one existing skip | 36.469 s |
| Full AnyAPI SQLite | 1598/1598 passed, no failures/skips | 42.573 s |
| Express 4 regular | 304/304 passed | 8.572 s |
| Express 4 AnyAPI | 304/304 passed | 9.587 s |
| Lint | Passed | — |
| Documentation | Passed | — |

The migration guide documents the permission and response-shape changes, including
cycle identifiers and regular/canonical pivot distinctions. `git diff --check`
passes; the saved migration patch checksum remains
`81c454022208ba2c1bc8d2a893a4e3eb9d7d5c8b09d8e86a4bf435ea9b6e2d3e`.
These batch checks do not close the final Part C reviews.

**Next verified defect (A2-10): joined search visibility.** An in-memory fixture
using the shared query-filtering hook hides every group: the direct group query
returns `[]`, and an item's group linkage is `null`. Nevertheless, filtering that
item by the hidden group's name returns its ID and a count of one. Both regular
and AnyAPI reproduce it (`/tmp/library-joined-visibility-inspection.log`). Required
behavior is an empty result/count for that hidden related-field match, while
independently matching primary fields in an OR search must remain eligible. The
next batch must apply related visibility inside search joins before filtering and
counts, with target action-permission checks and permanent regressions. Include
permission tests do not establish search-join isolation. Raw outer/atomic bulk
notification ownership, include-limit capability parity, real drivers and the
rest of the master plan also remain open.

## 2026-09-09: subscriber SQL visibility and notification isolation

The active goal continues within this repository. Consumer checkouts, seeds and
the parked migration are untouched. Verified completion remains **42/214
(19.6%)**, A35/138, B5/48, M2/14, C0/14; this batch extends A2-10 without
closing its remaining include/linkage action-permission coverage.

The previous Socket.IO path checked query action permission but matched write
snapshots with a separate JavaScript filter interpreter. That bypassed SQL row
policies and workspace autofilters, leaking IDs to hidden subscribers. It also
could not reproduce arbitrary SQL predicates, collation or relationship joins.
The first regression run (`/tmp/library-socket-policy-before.log`) failed 22 of
24 tests: 20 behavioral failures and two fixture setup failures because the test
ID field was not searchable. The ID fixture was corrected separately. The
initial corrected implementation passed 24/24 per backend in
`/tmp/library-socket-policy-knex.log` and
`/tmp/library-socket-policy-anyapi.log`.

Eligibility now calls the existing resource query before/after a write, using
its transaction and subscriber-owned context. The existing related-read internal
constraint is shared in `query-constraint.js`; it intersects the changed ID with
client filters without requiring a public ID search field. There is no forwarding
alias or second SQL/JavaScript filter engine. Ordinary query hooks retain their
attributes and configured sort, and query errors count as nonmatches. A successful
before or after match permits invalidation, with action permission checked again
at delivery. Relationship POST/DELETE expose their before-data-call boundary.

The `subscriptionFilters` hook can set trusted `subscription.context`; admission
and notification use it with stored auth. Client messages cannot set context.
Queue entries capture operation values plus a subscription generation, so reused
writer contexts and replacement subscriptions cannot replay a historical event
as a new change. Queues are private to the installed plugin and removed before
post-commit delivery. The earlier draft's `filterRecord` requirement is withdrawn;
the migration and Socket.IO guides describe the simpler SQL-only contract.

The new suite was expanded to **60 cases per backend**, covering both real
transports, row/workspace isolation, CRUD and relationships, rollback, reused
PUT-create context, trusted admission, subscriber replacement, non-atomic bulk,
SQL text/null/range/array/multi-field/split/join matching, and removal of the last
matching relationship child. `/tmp/library-socket-sql-expanded.log` failed its
28 new SQL cases during fixture setup because it used a removed plain foreign-key
input. Corrected fixtures use JSON:API relationship input and the API mount path;
that was a test error, not a runtime regression. The corrected focused command
passed **144/144 per backend**, no failures/skips, 8.816 s regular / 9.999 s
AnyAPI (`/tmp/library-socket-sql-expanded-fixed.log`). All focused socket,
authorization and connector commands now select this suite, including Express 4.

A7/B2 still must handle raw outer transactions and atomic bulk commit delivery.
Inspection confirms the bulk plugin calls `transaction.commit()` directly, so
successful atomic batches do not run the Socket.IO after-commit hook. Atomic
rollback and non-atomic success/failure notification tests pass, but they do not
establish successful atomic delivery. Live Redis transport, failed commit/rollback,
side-effect outcomes and notification query cost also remain open.

The complete `npm run verify` gate passed on Node 22.16.0, exit 0, log
`/tmp/library-socket-policy-full-gate.log`:

| Job | Result | Duration |
| --- | --- | --- |
| Full regular SQLite | 1513/1514 passed, zero failures, one existing skip | 42.833 s |
| Full AnyAPI SQLite | 1509/1509 passed, no failures/skips | 48.904 s |
| Express 4 regular | 292/292 passed | 11.516 s |
| Express 4 AnyAPI | 292/292 passed | 12.656 s |
| Lint | Passed | — |
| Documentation | Passed | — |

`git diff --check` passed. Source review confirmed the duplicate matcher and old
private constraint imports were removed, eligibility reads use subscriber context,
relationship capture precedes mutation, and queue entries do not retain the writer
context. The parked patch SHA-256 remains
`81c454022208ba2c1bc8d2a893a4e3eb9d7d5c8b09d8e86a4bf435ea9b6e2d3e`.
These are batch checks; Part C's three whole-goal reviews remain uncompleted.

The following section records the preceding implementation and its historical
gates; its snapshot-matcher design was superseded by the SQL query path above.

## 2026-09-09: related-read permissions and custom subscription filters

`conformance-related-permissions` now executes 114 cases per selected backend,
including real Express/Fastify requests and an Express 4 job. A to-one
`getRelated` now dispatches to target GET with all field/include selections;
the old shortcut bypassed target action/data permissions and finish hooks.
The parent keeps full attributes for its own data permission checks. Existing
row-policy tests retain hidden-target null responses, and new cases verify
zero/mapped IDs, target finish values, caller context and borrowed transactions.

The initial 93-case regression run had 45 failures, including forbidden HTTP
requests returning 200. Three parent authorization cases were added during
review. The focused runs at that stage passed 96/96 for regular and AnyAPI. The broader
first run's only failures after the fix were incorrect new wire-code assertions;
generic resource errors currently expose status/detail over HTTP, which are
now asserted separately from programmatic code/subtype.

The complete relationship batch gate passed on Node 22.16.0:

| Job | Result | Duration |
| --- | --- | --- |
| Full regular SQLite | 1431/1432 passed, zero failures, one existing skip | 30.564 s |
| Full AnyAPI SQLite | 1427/1427 passed, no failures/skips | 35.120 s |
| Express 4 regular | 226/226 passed | 4.367 s |
| Express 4 AnyAPI | 226/226 passed | 5.191 s |
| Lint | Passed | — |
| Documentation | Passed | 2.205 s |

Log: `/tmp/library-related-permissions-full-gate.log`. Existing mode-specific
and fixed-backend suite caveats still apply. No consumer checks were run.

A subsequent Socket.IO correction uses the existing SQL `applyFilter` contract
to identify custom filters during admission and snapshot matching. The old
function-valued `filterOperator` check admitted SQL-only filters and ignored
their `filterRecord` predicates. Updated real socket cases first reproduced
both transport failures, then passed with the fix. The fixture now executes
its real mapped SQL predicate through resource queries as well as verifying
matching/nonmatching notifications. Focused runs passed **84/84 per backend**
(2.385 s regular, 2.754 s AnyAPI), including WebSocket and HTTP polling. Log:
`/tmp/library-socket-custom-filter-sql-final.log`.

A2-11 is now defined and mapped to independent executed assertions in the
[conformance guide](conformance.md#independent-write-and-response-invariants).
The total is **42/214 (19.6%)**, A35/138, B5/48, M2/14, C0/14. A2-10 remains
open for broader include/linkage method permissions and notification isolation;
SQL matcher parity, real drivers, transaction outcomes and final reviews also
remain open. jskit-ai, vibe64, seeds and the parked migration were untouched.

The combined final runtime gate also passed
(`/tmp/library-resumed-auth-final-gate.log`): the same full test counts,
27.946 s regular / 31.734 s AnyAPI, Express 4 3.847 s / 4.364 s, lint, and
docs 1.873 s. A subsequent test-only review added four self-type polymorphic
permission cases to `conformance-authorization`, bringing that file to 60
cases per backend. The focused authorization command passed **274 regular /
275 AnyAPI**, with zero failures/skips (5.752 s / 7.588 s), log
`/tmp/library-resumed-auth-self-related.log`. Those cases prove the same-type
branch retains parent attributes and still enforces the target GET denial.

The subsequent source review reproduced the parent-fieldset issue in
`getRelationship` too: a forbidden parent GET was followed by a successful
linkage read. Its internal parent GET no longer forces an ID-only fieldset.
Six programmatic and twelve HTTP linkage cases cover all relationship shapes;
`conformance-related-permissions` now has **114 cases per backend**, and the
Express 4 selection includes its 15 HTTP cases. The reproduction log is
`/tmp/library-linkage-parent-permission-before.log` (expected exit 1).

The gate at `/tmp/library-resumed-auth-reviewed-gate.log` passed all test jobs
but failed lint on two new self-type test property-layout findings. Those
were corrected, and lint passed; the failed gate is not passing evidence for
the expanded final patch. Consumer checkouts remain untouched.

The complete expanded patch then passed `npm run verify` on Node 22.16.0,
exit 0, log `/tmp/library-resumed-auth-linkage-final-gate.log`:

| Final job | Result | Duration |
| --- | --- | --- |
| Full regular SQLite | 1453/1454 passed, zero failures, one existing skip | 34.873 s |
| Full AnyAPI SQLite | 1449/1449 passed, no failures/skips | 39.417 s |
| Express 4 regular | 232/232 passed | 4.579 s |
| Express 4 AnyAPI | 232/232 passed | 5.117 s |
| Lint | Passed | — |
| Documentation | Passed | 2.209 s |

The runtime and test files were unchanged after this final gate; only this
evidence and the master log were updated. `git diff --check` passed. Source
review found no remaining `hasRelevantQueryParams`/include-result shortcuts
in resource methods; the remaining `included.find` is response conversion,
not resource-method dispatch. Broader authorization and final reviews stay open.

## 2026-09-09: bulk authorization and reused write context

The new `conformance-bulk-authorization` file executes **56 cases per backend**.
It covers row-policy and workspace denial during atomic/non-atomic POST, PATCH
and DELETE; independent per-entry write permissions; both formats and all
return modes; hidden linkage in full responses; zero IDs on an integer-ID
resource; malformed atomic controls; and real Express/Fastify routes. HTTP
fixtures deliberately use plain/none programmatic defaults. Assertions inspect
persisted rows as well as responses and indexed failures. Pool acquisition is
bounded, and captured transactions are released if a regression assertion fails.

The first 26-case run passed all 12 direct cases and failed all 14 HTTP cases on
each backend. Bulk registered the obsolete `afterAddScope` hook, so POST was
absent and PATCH/DELETE could reach the ordinary `:id` route. Registration now
uses `scope:added` before ordinary routes. Handlers read the actual query string,
forward authenticated context, select JSON:API/full, and explicitly preserve
the DELETE batch summary with HTTP 200. Invalid `atomic` strings fail before
writes; direct calls require booleans. This optional plugin reserves the bulk
path for its HTTP methods, as documented in the migration guide.

Bulk POST/PATCH now reuse the existing response-option validators and forward
the selected format/return mode to ordinary CRUD. Plain records are not wrapped
as JSON:API input. Minimal/none results stay minimal/absent rather than triggering
a fallback GET. PATCH's structural guard accepts zero and handles null entries
without an accidental property-access error. A dedicated mapped integer-ID
fixture verifies zero; the row-policy fixture's `id` schema correctly rejects it.

The expanded independent permission tests reproduced a connection leak after a
previous successful write populated `context.transactionCommitted`. A denied
non-atomic entry inherited true and skipped rollback; the next entry timed out
acquiring the occupied SQLite connection. Both live runs were stopped after
that failure was established; neither is recorded as a completed gate. Every
resource/relationship write now resets the commit flag, and common request
setup resets ownership before validation. Existing commit/rollback helpers
remain the implementation; no transaction framework was added.

`conformance-transaction-context` adds **16 cases per backend**: all seven write
methods after a committed call, each with an owned and borrowed transaction,
plus PUT replacement and creation using reused context. Failures before commit
restore stored records/relationships for owned transactions and leave borrowed
transactions active until the test caller rolls back. The suite also found
stale `originalInputAttributes` and `minimalRecord` affecting PUT validation;
common request setup now clears those per-operation snapshots. A prior payload
cannot excuse current omissions, and a previous record cannot impose fields on
a new ID. Test development also corrected incomplete PUT payloads, the scalar
plain belongsTo input convention, and an overly strict nested-error assertion.

Final `npm run verify`, Node 22.16.0 / SQLite, exit 0:

| Stage | Tests | Passed | Failed | Skipped tests | Duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| Regular | 1336 | 1335 | 0 | 1 | 31.948 s |
| AnyAPI | 1331 | 1331 | 0 | 0 | 31.468 s |
| Express 4 regular | 217 | 217 | 0 | 0 | 3.794 s |
| Express 4 AnyAPI | 217 | 217 | 0 | 0 | 3.976 s |
| Lint | — | success | 0 | — | — |
| Documentation | — | success | 0 | — | 1.988 s |

The connector commands include the new bulk file; the Express 4 selector
executes its 11 Express HTTP cases. The authorization command includes both new
files and the historical bulk suite. Mode-selected suites, backend-fixed
fixtures and pending real-driver coverage remain limitations of the gate.

The packaged consumer command passed **353 tests**, zero failures/skips, on
Node 26.5.0 / Knex 3.2.10: users-core **43** (1.835 s), workspaces-core **142**
(3.315 s), crud-core **145** (3.197 s), json-rest-api-core **23** (4.929 s).
jskit-ai HEAD remained `70163546304ee1fed80cbf1c6ec67517294db855` with its pending
migration/expansion changes preserved. This is one additional CRUD test compared
with the preceding artifact run, not a reused count. The runner verified exact
package resolution, unchanged source fingerprints and temporary-install cleanup.
Artifact: version `1.0.29` (unpublished worktree), SHA-256
`bfc82d9e55f5e619012c262db1a83e02d260c3a7082b2d169cb70949739b6e26`, integrity
`sha512-t9RLFqu+UvEH/G7G/COUGif3vIXGgRq3wq+kpXcca0y3apQaA3XrERR0SH62jdlWlKYVEs+l0ND4EuB767f6Rw==`.
The installation `/tmp/json-rest-consumer-lbco1G` was removed. Runtime, migration
guide and scripts were unchanged after packing; this evidence text was added
afterward.

No scoped JS/TS/MJS/JSON/Markdown source search found bulk-plugin/method callers
in jskit-ai, vibe64 or either seed. No consumer source was edited in this batch.
A read-only vibe64 refresh observed HEAD
`8fd35fc9fada4741a5427450d324ebd6446b6463` and unrelated integration/source-editor
work. Earlier pending API migrations are in jskit-ai; earlier persistence-test
edits are in the accounts seed, not vibe64.

Evidence logs: `/tmp/library-bulk-auth-{knex,anyapi}-before.log`,
`/tmp/library-bulk-auth-{knex,anyapi}-expanded.log` (stopped after the confirmed
leak), `/tmp/library-bulk-auth-full-gate.log`, and
`/tmp/library-bulk-auth-consumer.log`. A2-10 still needs the target method-
permission/include and notification matrix. A4/A7/B2 still own the broader
context-state audit, bulk caller transactions, outcome evidence and deferred
events. Bulk argument/configuration consolidation and its inactive optimization
hook remain open under B0/A8. No whole checklist item is closed by this batch:
**41/214 (19.2%)**, A **34/138**, B **5/48**, M **2/14**, C **0/14**.

## 2026-09-09: to-one linkage visibility

The A2-10 reproduction in the preceding query batch is fixed. A new shared
authorization suite now runs **56 cases per backend**, separately hiding rows
by a row policy and by workspace autofilters. It covers GET/query, both formats,
sparse fields, included leaf resources, belongsTo and polymorphic linkage,
relationship/related endpoints, primary denial, related counts, full PATCH
responses, and a borrowed transaction that changes visibility then rolls back.
Direct storage inspection confirms that response filtering does not clear the
foreign keys. API setup and seeding remain in the existing fixture module.

The first 20-case matrix failed 14 regular and all 20 AnyAPI cases. Four regular
failures were a test expectation error: plain null-belongsTo fields are omitted,
not emitted as null. That existing convention is now explicit in assertions and
the migration guide. The remaining failures exposed hidden IDs in primary or
included resource linkage, including AnyAPI's linkage endpoint with an include.

The previous AnyAPI `filterVisibleIdentifiers` implementation has moved into
the existing relationship module and uses the common storage adapter for its
base query, ID column, values and resource scope. Existing AnyAPI membership
callers use that implementation. GET/query apply it to outgoing belongsTo and
polymorphic linkage on primary and included records after finish hooks and
before plain conversion. Queries group references by resource type, retaining
row-policy/autofilter context and caller transactions. Existing include-filter
hooks also receive the adapter's canonical-storage flag.

The first expanded run passed 271 regular cases but failed six existing AnyAPI
zero-ID cases. A direct SQL probe confirmed that its adapter bound numeric zero
against the canonical text logical-ID column and matched no row. The canonical
adapter now retains string logical IDs in comparisons, using the existing
relationship-value conversion. The corrected expanded run passed **271 regular /
269 AnyAPI**, covering the authorization, ID, temporal and query matrices.
The later four borrowed-transaction cases also pass in the gate below.

Final `npm run verify`, Node 22.16.0 / SQLite, exit 0:

| Stage | Tests | Passed | Failed | Skipped tests | Duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| Regular | 1264 | 1263 | 0 | 1 | 36.902 s |
| AnyAPI | 1259 | 1259 | 0 | 0 | 34.191 s |
| Express 4 regular | 206 | 206 | 0 | 0 | 3.925 s |
| Express 4 AnyAPI | 206 | 206 | 0 | 0 | 4.185 s |
| Lint | — | success | 0 | — | — |
| Documentation | — | success | 0 | — | 2.141 s |

The added `npm run test:authorization` command passed **84/84 regular** and
**85/85 AnyAPI**, with zero skipped tests, in **3.399/4.510 s**. It combines the
new matrix with the existing row-policy/autofilter suites. Backend-fixed
fixtures, mode-specific skipped suites and real-driver limits still apply to
the full gate; zero individual skips does not erase those coverage limits.

All **352 selected jskit-ai tests** passed against the final runtime artifact on
Node 26.5.0 and Knex 3.2.10. Consumer HEAD remained
`70163546304ee1fed80cbf1c6ec67517294db855`; unrelated expansion work was preserved.
Resolution under `/tmp/json-rest-consumer-KCApN0/node_modules/json-rest-api`,
dependency fingerprint checks and subsequent temporary-directory removal were
verified. SHA-256:
`3040dcf5613b2cbd3e1b3947794bbf12597f40c9fdfa6b8fb8cf7e6f0f24aacb`.
Integrity:
`sha512-JLDmGUtfJK1zbTFmDW81zFd2MyMzYAzOTOjGeo3aequayWHYjCvJPbaebPahAeyhm7hdbOVesj46Bw3tJKCyZA==`.
Only focused npm scripts and evidence prose changed after packing.

This fixes the reproduced linkage defect without closing A2-10. Method-level
permission behavior across includes/linkage, bulk operations, the remaining
relationship/notification visibility matrix and adversarial policy cases still
require verification. The master total remains **41/214 (19.2%)**.

## 2026-09-09: query conformance batch

The shared query suite covers both formats, independent filter/count expectations,
sparse projections, hidden dependencies, nullable/tied/projected sorting, capped
cursor/offset traversal and generated-link round trips. Related collections add
inverse membership, duplicate links, borrowed transaction rollback, target query
permissions, nested-query isolation and a fixed SQL round-trip regression. Two
regular-only cases exercise mapped pivot-resource permission and filter hooks.
The suite contains 89 shared cases plus those two regular-storage cases.

The initial fixture mistakenly supplied `inputRecord` to a relationship method;
its setup failures were corrected to use `relationshipData` and are not counted
as library defects. Later test corrections account for empty parsed filter maps,
cross-table search resource names and the required `indexed` field declaration.
The include validator was corrected to support inferred many-to-many targets
after the historical include suites exposed that missing case.

Confirmed defects fixed in runtime:

- Many-to-many related reads ignored target filtering or rejected target sort
  fields, fetched members individually and did not share normal target pagination.
  Both backends now use target queries constrained by SQL membership subqueries.
- Null inequality used SQL `!= NULL`; it now uses `IS NOT NULL`. BETWEEN comparisons
  honor OR grouping, and invalid bound counts/null bounds reject rather than drop
  the predicate. Split OR searches now apply each term in both local and joined
  filters. Redundant per-term serialization in local AND search was removed.
- Joined AnyAPI queries selected/sorted unqualified physical columns, producing
  ambiguous-column errors. Selection, sort and cursor predicates are qualified,
  while cursor values still use the actual result-column names.
- Both backends counted fan-out join rows instead of distinct primary resources.
  A regression with two parents and three matching children failed `3 !== 2`
  twice per backend before the distinct-count correction.
- Plugin-level `enablePaginationCounts: false` was overridden by a truthy fallback.
  Its test now observes that no count SQL is issued.
- Unsupported include paths were ignored, including on empty collections. Shared
  schema validation now raises `REST_API_INCLUDE_INVALID`; real connectors map
  it to HTTP 400 with `source.parameter: 'include'`. Nested/polymorphic paths,
  inferred targets and finite cycles retain coverage; absent to-one targets are
  validated too.

`npm run test:queries` passed **153/153 regular** and **151/151 AnyAPI**, zero
failures or skipped tests, in **22.048/30.268 s** on Node 22.16.0. Its explicit
command is in package.json and full verification also discovers the new suites.
The earlier complete gate passed before the distinct-count regression was added;
the final gate and packed artifact check below include that later runtime fix.

Final `npm run verify`, Node 22.16.0 / SQLite, exit 0:

| Stage | Tests | Passed | Failed | Skipped tests | Duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| Regular | 1208 | 1207 | 0 | 1 | 54.446 s |
| AnyAPI | 1203 | 1203 | 0 | 0 | 40.354 s |
| Express 4 regular | 206 | 206 | 0 | 0 | 3.915 s |
| Express 4 AnyAPI | 206 | 206 | 0 | 0 | 4.317 s |
| Lint | — | success | 0 | — | — |
| Documentation | — | success | 0 | — | 2.176 s |

Existing mode-specific skipped suites and backend-fixed fixtures remain coverage
limits even where individual skipped-test counts are zero. Full suites execute
Express 5 and Fastify 5; the additional jobs execute Express 4. This is SQLite
evidence, not PostgreSQL/MySQL integration.

Final consumer runner, Node 26.5.0, jskit-ai HEAD
`70163546304ee1fed80cbf1c6ec67517294db855` with the previously recorded dirty
expansion preserved: **43 users + 142 workspaces + 144 CRUD + 23 host = 352
passes**, zero failures. It resolved the packed library under
`/tmp/json-rest-consumer-b4sZpH/node_modules/json-rest-api`; that temporary directory
was removed and the runner's dependency fingerprint checks passed. Consumer Knex
remained 3.2.10. Runtime artifact SHA-256:
`b882d3284045aa1ea08d219382521fa9072d18e08f5d116471c15a5ea07608a1`.
Integrity:
`sha512-TN7yiiCCRRtKPKDX8kMkFZJmfLx69tHCKwxnzoorKKG481/xMggJLo14MR88A1wFt2ie50ZTaR52rtspxNvvIA==`.
Only evidence/checklist prose changed after packing. Full library diff check
passed. Consumer dependency coordination and final app workflows remain open.

A2-09 is checked: **41/214 (19.2%)**, **A 34/138, B 5/48, M 2/14, C 0/14**.

The next A2-10 audit has already reproduced a separate visibility defect with
the existing row-policy fixture: a visible task exposes the hidden parent ID in
belongsTo linkage without an include on both backends. Regular storage clears
that linkage when the parent is included; AnyAPI still exposes it with the
include. The existing test checked only absent included records and missed the
identifier. This remains open and must be covered across representations and
relationship kinds before A2-10 can close. Query conformance is not a claim of
full authorization, real-driver or final-review completion.

## 2026-09-08: complete standard gate and include regressions

`npm run verify` now runs `npm test`, `npm run test:anyapi`, `npm run lint`, and
`npm run docs` in that order, stopping on failure. Focused ID commands remain
available. New integration/type/package checks will be added as their implementations
land; they are not yet part of this passing result.

Curl tests bind an allocated loopback port and use the actual address. Startup
errors reject the setup promise. Curl has connection/transfer/process timeouts;
server cleanup closes active connections and database teardown runs even if server
shutdown fails. A simultaneous regular/AnyAPI run exercised both HTTP servers with
no port collision. Other fixture/process cleanup remains under A1-03/A1-04.

Lint now includes maintained tests and scripts. Existing findings were resolved
by removing unused bindings while retaining awaited setup calls, fixing reported
layout errors, and documenting two narrowly scoped exceptions for executing
generated migration code against SQLite. Existing assertions were retained.

An unused `countries` variable in the three-level include test exposed a missing
assertion. Checking its expected two countries failed before the traversal fix.
Further shared regressions found incorrect hasOne response formatting, traversal
suppression after a resource was already included, and missing AnyAPI hasOne reads.

Changes preserve existing request syntax and use the existing response converters:

- Regular include traversal tracks resource type, ID and path together. Recursive
  loaders no longer treat the already-visited parent edge as a reason to skip its
  children. Already-included resources can still have unvisited child paths.
- AnyAPI uses a request-local Map to deduplicate response resources, while processing
  each remaining requested subtree. It does not use response deduplication to stop
  traversal. Include trees are finite, validated request paths.
- Regular hasOne formatting now passes the actual row and resource type to
  `toJsonApiRecord`, and preserves relationship metadata, computed dependencies and
  links. AnyAPI reuses reverse-relationship reads with singular object/null linkage.
- Nested relationship results update their existing included resource, including
  filtered or null linkage. Sparse attributes retain the library's existing
  relationship-linkage behavior; changing that contract is outside this fix.

`tests/include-traversal.test.js` uses one fixture and the same eight assertions
under both storage modes. It covers three-level traversal, finite cycles,
resources reached through multiple paths, two hasOne parents, polymorphic and
reverse-polymorphic paths, sparse attributes and absent hasOne records. The prior
nested-include suite also now checks the previously unasserted countries.

Full gate result on Node 22.16.0 with SQLite:

| Stage | Tests | Passed | Failed | Skipped tests | Duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| Regular | 494 | 493 | 0 | 1 | 23.718 s |
| AnyAPI | 491 | 490 | 0 | 1 | 26.032 s |
| Expanded lint | — | success | 0 | — | — |
| Documentation | — | success | 0 | — | Jekyll generation 2.757 s |

A temporary `verification-sentinel.test.js` then deliberately threw
`EXPECTED_GATE_SENTINEL`. Running the actual `npm run verify` command exited 1
after the regular suite (493 passed, one intentional failure, one skipped); the
AnyAPI/lint/docs stages did not start. The sentinel was removed in `finally` and
its absence checked. The completed positive gate above used the same runtime code.

The same baseline mode-specific skips remain. Real PostgreSQL/MySQL/Fastify,
generated conformance cases and the Part B API additions remain unimplemented or
unverified; this result does not establish those capabilities.

## 2026-09-08: fixture isolation and cleanup

Creating another AnyAPI fixture previously deleted all tenants' records and
configuration. Its global table registry also lost mappings when another fixture
started, or confused identical table names on separate Knex connections. Three
new isolation assertions failed before the correction.

Fixture creation now preserves existing data. Cleanup metadata uses a WeakMap
keyed by the actual Knex instance, with explicit tenant IDs taken from each API.
Table and relationship cleanup use those mappings. Missing mappings/tables and
database errors are reported instead of being treated as successful cleanup or
zero records. The stricter checks exposed missing field-setter, virtual-field,
search-schema and query-limit fixture registrations; these were filled in. The
setter-error resource is now registered once in the fixture module.

`tests/fixture-isolation.test.js` exercises two tenants sharing one database and a
third tenant on a separate database with the same table names. Its four tests
check initialization, selective cleanup, counts and missing-table errors. All four
pass in each mode, both as focused tests and inside the complete suites.

Socket fixture startup now handles listening errors and cleans up partial setup.
Teardown attempts Socket.IO, Redis clients, HTTP and auth cleanup even if an earlier
step fails, reporting collected errors. The suite destroys its borrowed Knex
connection in `finally`, including when setup fails. Socket connection timers and
listeners are removed when settled; acknowledgements use a five-second timeout.
Temporary-directory cleanup only targets a directory successfully allocated by
that test. Registry entries are weakly held by their owning Knex connection.

Documentation subprocesses have a ten-minute command timeout; browser launch has
a fifteen-second timeout. On Linux, Jekyll runs directly so shutdown signals reach
the server. Serve-mode timers and listeners are cleared, and the parent awaits
child termination. Use `npm run docs:dev -- --no-open` to serve without opening a
browser. A live manual check obtained HTTP 200 and then verified parent exit 0
and released port 4000 for both SIGTERM and SIGINT. An injected Socket.IO-disconnect
failure and Redis-quit failure confirmed the other cleanup steps still ran, the
HTTP server closed, and both original errors were retained in an AggregateError.
Calling cleanup on an uninitialized fixture also succeeded.

Verification on Node 22.16.0 / SQLite:

| Scope | Regular | AnyAPI |
| --- | --- | --- |
| Isolation, Socket.IO and field setters together | 28 passed, zero failed | 28 passed, zero failed |
| Complete suites | 497 passed, zero failed, one skipped (498 tests; 19.656 s) | 494 passed, zero failed, one skipped (495 tests; 22.033 s) |

The full gate then caught a `prefer-const` finding in the documentation script;
it was fixed and expanded lint passed. The final cleanup adjustment, which keeps
closing Socket.IO after an explicit disconnect failure, was checked by the
injection above and rerunning both Socket.IO suites. Existing capability skips
remain; real-driver integration and later plan items are still open.

## 2026-09-08: Node runtime verification

An isolated copy of the current runtime, tests, scripts and package lock was
installed with Node 24.6.0 using `npm ci --no-audit --no-fund`. Its locked
`better-sqlite3` 11.10.0 compiled from source successfully. The complete regular
suite passed 497 of 498 tests (zero failures, one skipped; 15.779 s); AnyAPI passed
494 of 495 (zero failures, one skipped; 20.157 s). Expanded lint also passed.
The temporary checkout and its native modules were removed afterward; the main
Node 22 installation was not rebuilt or changed.

The [development guide](verification.md) defines the maintained Node 22/24
development matrix and clean-checkout commands, documents required public tools,
and distinguishes verified development support from unchanged consumer engine
behavior. `.nvmrc` pins the Node 22.16.0 baseline used throughout the earlier
results. CI database/connector coverage is still tracked separately under A1-08.

## 2026-09-09: shared conformance and generated cases

The [conformance guide and coverage map](conformance.md) records the fixture
interface, independent expectations, deterministic seeds, replay commands, ID
storage domains and remaining hardwired-backend coverage. The dedicated suite
now runs 16 tests per selected backend, including 200 generated cases. Generated
operation sequences check persisted state, filtered queries and relationship
linkage against an independent Map after each operation. Pagination checks full
forward/backward traversals against independent ordering, including ties, nulls,
sparse fields and consumption of generated links.

Making fixture IDs deterministic exposed an AnyAPI explicit-numeric-POST bug:
the driver could bind numeric `1` into the text logical-ID column as `"1.0"`.
The existing AnyAPI ID normalizer now converts the value before binding. Fixed
no/minimal/full-return cases and the saved generated replay failed with the old
line and passed with the correction. The regression and exact replay are recorded
in the conformance guide. No numeric cast was added to AnyAPI's existing opaque
logical-ID ordering contract.

Full `npm run verify` on Node 22.16.0 / SQLite:

| Stage | Tests | Passed | Failed | Skipped | Duration |
| --- | ---: | ---: | ---: | ---: | --- |
| Regular command | 514 | 513 | 0 | 1 | 27.737 s |
| AnyAPI command | 511 | 510 | 0 | 1 | 29.049 s |
| Expanded lint | — | success | 0 | — | — |
| Documentation | — | success | 0 | — | Jekyll generation 3.883 s |

These are command totals, not proof that every legacy file switches backends.
The conformance map identifies files that instantiate one backend directly.
New conformance fixtures check their actual selected backend; their npm commands
explicitly select each mode even if the parent process has a different selection.
Later real-driver/connector coverage, the remaining conformance matrix and Part B
API additions remain open.

## 2026-09-09: API and consumer migration revision

The maintainer authorized direct API changes with coordinated ports of jskit-ai
and its downstream apps. Revision 2 of the root plan removes preservation-only
requirements and compatibility-layer work, adds explicit migration and API
simplification checklists, and keeps the four capability areas separate. The
old plan is archived as historical evidence. Counts are now 24/214; revising the
document does not complete implementation work.

The [consumer inventory](consumer-migration.md) records the inspected jskit-ai
checkout, actual host/repository integration, moving worktree, and 65 passing
selected tests on its installed dependency. These passes are a consumer baseline,
not evidence that the new API or library worktree has been adopted. The
[short migration guide](../GUIDE/MIGRATING_API_V2.md) is explicitly a target-API
draft until its examples execute against the implementation.

Before the direction changed, `conformance-formats.test.js` added 40 fixed cases
per backend covering GET/query formats and POST, PUT-create, PUT-replace, PATCH,
and DELETE with global/resource defaults, transport selection, overrides, and
boolean aliases. Those focused runs passed 40/40 in each backend with no skips.
They characterize the old contract; B0 will migrate their useful assertions and
remove alias-only requirements. No new full-library gate has been claimed for
those additions. The latest full-library results remain the preceding entry.

## 2026-09-09: direct response API and first consumer source port

The [migration guide](../GUIDE/MIGRATING_API_V2.md) now describes implemented
worktree behavior: format/returning string options, scalar defaults, explicit
inputRecord, HTTP representation selection, and result shapes. The old parser,
boolean aliases, transport-specific core defaults, and plain-input document
autodetection have been removed. Context/transaction arguments retain their
existing placement. The related-resource formatter reuses existing conversion.

The matrix now has 60 tests per backend, with each default configured through
actual plugin/resource options. Boundary tests reject malformed and removed
options and distinguish control names from record data. Two related fixes have
regressions: HTTP relationship routes forward the connector's request context;
linkage reads use the caller transaction without completing it.

| Check | Passed | Failed | Skipped | Duration |
| --- | ---: | ---: | ---: | --- |
| Full regular SQLite command, Node 22.16.0 | 577 | 0 | 1 | 42.381 s |
| Full AnyAPI SQLite command, Node 22.16.0 | 574 | 0 | 1 | 31.235 s |
| Selected migrated jskit-ai checks against worktree tarball, Node 26.5.0 | 73 | 0 | 0 | 11.170 s |
| Library lint | success | 0 | — | — |
| Changed jskit-ai JS ESLint | success | 0 | — | — |
| Documentation build | success | 0 | — | 8.794 s |

The regular full run preceded two test-only fixes for AnyAPI (one variable-based
shorthand call and a per-table-ID assumption); the latter full run includes
those fixes. Both runs include the runtime changes. The quickTest example was
then repaired and executed on an allocated loopback port: all programmatic
calls completed, HTTP includes/filtering returned the expected data, and SIGTERM
closed the server/database with exit zero.

These remain command totals; the earlier hardwired-backend limitations apply.
Fastify parity is still simulated, seeds are not yet migrated to the final
package graph, and this is not a full-goal completion claim. Open conformance
findings: generic SQLite object outputs require an explicit JSON getter;
getRelated's parent filter currently depends on searchable relationship
configuration. They remain A2/A8 work.

M-01 and B0-02–B0-06 are now checked: **30/214 (14.0%)**. The migration guide
is substantially updated, but final package/version selection and later
capability sections remain pending.

## 2026-09-09: paired seed artifacts and persisted account workflow

M-04's artifact path is now implemented and verified. `test:consumer` accepts
`--jskit PATH` to pack the current required jskit cohort alongside the library,
install into a disposable copy, and assert normal npm package locations before
running the application's unchanged check command. Current consumer manifests,
locks, and installed dependencies are not modified. See the [commands, snapshot,
artifact identity, and limits](consumer-migration.md).

Actual account persistence exposed plain-output repositories still constructing
JSON:API inputs. Six repositories now use direct plain fields/relationship IDs;
PATCH IDs stay outside inputRecord. Their redundant document builders/imports
were removed, and the mixed-format migration example is in the API guide.

| Check on Node 26.5.0 | Passed | Failed | Skipped | Detail |
| --- | ---: | ---: | ---: | --- |
| All users-core tests | 43 | 0 | 0 | Packed library; 0.978 s |
| All workspaces-core tests | 142 | 0 | 0 | Packed library; 1.943 s |
| All crud-core tests | 144 | 0 | 0 | Packed library; 1.606 s |
| All json-rest-api-core tests | 23 | 0 | 0 | Packed library; 1.702 s |
| Accounts seed persistence integration | 1 | 0 | 0 | Library + 21 current jskit artifacts; MariaDB 12.0.2; 4.821 s |
| Public seed full verify | success | 0 | 0 | Package check, lint, 1 server + 1 client test, build |
| Accounts seed full verify | success | 0 | 0 | Package check, lint, 1 server + 1 client test, build |
| Changed jskit-ai JS lint | success | 0 | — | All 13 changed files |
| Library lint | success | 0 | — | Includes expanded artifact runner |

The new accounts integration test prepares migrations and uses real Fastify
request injection for registration, profile changes, logout/login persistence,
authentication rejection, and two independent users' settings. The private
MariaDB process and directory were removed after the successful run. This does
not establish Oracle MySQL/PostgreSQL, browser, or the library's own Fastify
connector coverage.

Earlier full seed checks failed because staged dependencies were collected by
automatic app test discovery or linted under the app's rules. Moving candidates
under `test-results/.jskit-candidate-packages` respects both existing boundaries;
both full commands now pass with unchanged app verification rules. Their
disposable installs were removed, and source dependency fingerprints matched.

No library runtime changed in this batch; the preceding full SQLite results
remain applicable. Final consumer version/dependency updates, remaining
capabilities/conformance, and the three final audits remain open. Verified total:
**31/214 (14.5%)**.

## 2026-09-09: related collection membership, filters and links

The hasMany related read no longer manufactures a public search filter for parent
membership. The existing storage adapters apply logical field/value constraints
to regular and canonical storage, including mapped foreign keys and polymorphic
type/ID pairs. The constraint is carried by an internal symbol, scoped to the
specific target query, and is reset for independent nested queries. Public
filters still use the existing validator and retain their own meaning.

Both row selection and pagination counts include membership before limits.
Generated pagination links retain the parent relationship route and the public
query parameters, including forward/backward cursors and requested fields.
No compatibility parser, schema-search override, or new public option was added.
Two duplicated hasMany query branches were reduced to one target query.

The original 23-case related/include regression run failed 10 tests. With the
correction and additional boundary tests, focused runs passed 62 regular and 63
AnyAPI tests. They include row policy/autofilter isolation, independent nested
queries, borrowed transactions, and real Express pagination-link traversal.

| Check | Passed | Failed | Skipped | Duration |
| --- | ---: | ---: | ---: | --- |
| Full regular SQLite command, Node 22.16.0 | 599 | 0 | 1 | 46.765 s |
| Full AnyAPI SQLite command, Node 22.16.0 | 596 | 0 | 1 | 49.909 s |
| Four affected jskit-ai packages against packed library, Node 26.5.0 | 352 | 0 | 0 | All four package commands exited zero |
| Expanded library lint | success | 0 | — | — |

The full-suite backend limitations documented above still apply. The conformance
file itself explicitly selects and verifies each backend through its fixture.
This fix covers direct and polymorphic hasMany reads; the many-to-many batching
and capability work remains open.

Six manual mutation probes (three operations on each backend) found further
defects: hasMany POST/DELETE fail with `Foreign key fields cannot be set directly
in attributes`; hasMany PATCH resolves successfully but preserves the original
membership instead of replacing it. These are recorded as open A2/A4/A7 findings.
They do not count as passing tests or completed endpoint coverage. No broader
checklist item is closed by this partial relationship correction: **31/214
(14.5%)** remains the verified total.

## 2026-09-09: relationship writes and complete endpoint coverage

The shared reverse relationship writer computes actual membership changes and
uses child resource PATCH for each mutation. It handles hasMany, hasOne, and
polymorphic reverse membership without routing internal IDs through paginated
public queries. Permissions, caller context and transactions reach those child
writes. Full replacement rejects inaccessible existing members and rolls back
earlier changes when the operation owns its transaction; borrowed transactions
remain the caller's responsibility.

Further regressions cover explicit null foreign-key validation, wrong target
types, duplicate many-to-many additions, mapped pivot columns, aliased target
types, caller context during many-to-many replacement, and sparse polymorphic
linkage reads. The [endpoint map](conformance.md#resource-and-relationship-endpoint-map)
records each public operation's assertions. The new reverse-write file has 42
cases per backend, with normal/custom child IDs and complete membership beyond
public query caps. Real Express tests independently read back to-many changes.

| Check | Passed | Failed | Skipped tests | Duration |
| --- | ---: | ---: | ---: | --- |
| Full regular SQLite command, Node 22.16.0 | 646 | 0 | 1 | 49.180 s |
| Full AnyAPI SQLite command, Node 22.16.0 | 643 | 0 | 1 | 52.186 s |
| users-core against packed library, Node 26.5.0 | 43 | 0 | 0 | 3.694 s |
| workspaces-core against packed library, Node 26.5.0 | 142 | 0 | 0 | 6.964 s |
| crud-core against packed library, Node 26.5.0 | 144 | 0 | 0 | 7.265 s |
| json-rest-api-core against packed library, Node 26.5.0 | 23 | 0 | 0 | 4.599 s |
| Library lint and git diff --check | success | 0 | — | — |

Commands were `npm test`, `npm run test:anyapi`, `npm run lint`, and
`node scripts/check-consumer-package.js --consumer /home/merc/Development/current/jskit-ai -- npm test --workspace @jskit-ai/users-core --workspace @jskit-ai/workspaces-core --workspace @jskit-ai/crud-core --workspace @jskit-ai/json-rest-api-core`.
The consumer artifact SHA-256 was
`13388ffa061643bdf9a6292f72f56c6acd32c8567b7e2a1458d6bd135d59d64e`.
Package resolution was verified inside a disposable install, source dependency
fingerprints matched, and its staging directory was removed. This packed
snapshot includes the final runtime changes; subsequent edits corrected library
fixtures/assertions and documentation only.

The initial full commands each failed the older custom-ID PUT test because its
fixture placed a polymorphic relationship inside `schema`; the compiler never
registered that relationship. The fixture now declares it under `relationships`.
Its tests use JSON:API linkage and verify custom-ID forward/reverse reads, rather
than treating discriminator attributes as proof of a working relationship.
The corrected custom-ID suite passed 18/18 on each backend before the final full
commands. No runtime fallback for the invalid declaration was added.

The regular command skips the AnyAPI cursor/custom-ID suites and one canonical
fixture-cleanup test. The AnyAPI command skips regular-storage introspection,
pagination-contract and search-merge suites, plus one custom serializer test.
Node's totals above count skipped tests separately from skipped suites. Existing
hardwired regular fixtures still do not establish AnyAPI parity. Real databases,
Fastify connector parity, concurrent membership changes, the final transaction
contract, and many-to-many query pagination/budgets remain open.

A2-03 is now checked. The verified full-plan total is **32/214 (15.0%)**:
internal work **25/138**, API work **5/48**, migrations **2/14**, final reviews
**0/14**. This is endpoint coverage and targeted correction, not completion of
the broader conformance, migration or final-audit requirements.

## 2026-09-09: real HTTP connector execution and format matrix

The old parity file manually invoked a fake Fastify route and always used
regular storage. It now parameterizes actual Express 5.1.0 and Fastify 5.12.3
request handling, with each programmatic return default, and explicitly asserts
the selected regular/AnyAPI backend. The 78 real integration cases run alongside
three focused Fastify registration/schema unit tests. The unused fake route
invocation helper was removed. `fastify` is now a development dependency, pinned
by the lockfile; the library still accepts the application's Fastify instance.

The first real run passed 27 tests, failed six malformed-JSON Express assertions,
and cancelled 33 Fastify cases because server startup failed on Ajv's unknown
`x-json-rest-schema` keyword. Those failures required production fixes:

- Fastify's route validator compiler now calls the existing request contract,
  retaining typed errors and authored coercion without Ajv silently deleting
  fields. The exported route schema remains available for inspection.
- Fastify creates request context and runs transport request hooks before
  validation, so validation errors can use the normal response hook.
- Express catches body-parser failures through its existing JSON:API error
  handler, returns the JSON:API content type for error/rejection responses, and
  awaits route error handling.

The final focused run passed 81/81 on each backend. It includes accepted scalar
coercion, explicit null PATCHes, both JSON content types, unknown-field
rejection, resource-level return overrides, real relationship changes, and
independent persisted-state assertions. The [coverage map](conformance.md#real-connector-defaults-and-validation)
records what satisfies A2-04 and A3-07 and what remains under other items.

| Check | Passed | Failed | Skipped tests | Duration |
| --- | ---: | ---: | ---: | --- |
| Full regular SQLite command, Node 22.16.0 | 717 | 0 | 1 | 54.637 s |
| Full AnyAPI SQLite command, Node 22.16.0 | 714 | 0 | 1 | 57.784 s |
| users-core against packed library, Node 26.5.0 | 43 | 0 | 0 | 4.641 s |
| workspaces-core against packed library, Node 26.5.0 | 142 | 0 | 0 | 6.873 s |
| crud-core against packed library, Node 26.5.0 | 144 | 0 | 0 | 6.969 s |
| json-rest-api-core against packed library, Node 26.5.0 | 23 | 0 | 0 | 5.845 s |

The full-suite skip explanations in the preceding entry still apply. The
consumer artifact SHA-256 was
`32468ea9b5ea14963f0cea1d9c682d5876c95bc841583465ebfdc970ef6fca28`;
resolution was checked inside a disposable install. Subsequent edits changed
one indentation level, npm check commands and documentation only.

Use `npm run test:connectors` for both modes, or `npm run test:connectors:knex`
and `npm run test:connectors:anyapi` individually. The regular full test commands
already include these files, so the normal verify gate does not repeat them.
Real PostgreSQL/MySQL, Express 4, remaining framework versions, body limits,
content negotiation, unknown routes, multipart, and remaining API/migration
boundaries stay open. These checks do not constitute the final triple review.


## 2026-09-09: HTTP boundaries and Express 4/5 matrix

The real connector matrix now runs Express 5.1.0 / Fastify 5.12.3 on each
storage mode, with all three programmatic return defaults, plus Express 4.22.2
using the same Express tests. `npm run verify` includes both Express 4 jobs;
`npm run test:connectors` exposes the complete focused matrix. The development
alias and test preload redirect the actual production Express import and assert
its version/path. A temporary resolver failure for that alias produced exit 1
before tests could start, proving there is no fallback to Express 5.

Confirmed defects and corrections:

- Complete media-type parsing replaces substring matching. Incompatible Accept
  values produce 406; unsupported JSON:API parameters/extensions produce 415;
  unrecognized profiles are ignored. Unsupported content types are rejected
  before JSON parsing, including malformed bodies under those types.
- Real serialization had appended a forbidden charset in both frameworks.
  Express uses `on-headers` and Fastify uses `onSend` to set the exact JSON:API
  media type while retaining framework serialization. Vary preserves both
  Accept and Origin; the existing CORS assertions now check that contract.
- Scalar/null/array request documents use typed 422 errors. Parser errors and
  size limits use 400/413, and rejected writes leave storage unchanged.
- The query parser keeps fractional pagination values for integer validation,
  preserves opaque numeric-looking cursors and literal map keys, and rejects
  retired controls. Shared URL extraction now preserves literal question marks
  inside query values. The latter failed all six connector variants before
  correction. Unknown fieldset resource types use the existing typed fieldset
  error in HTTP and programmatic calls instead of silently disappearing.
- Express request middleware and 404 handling respect the API prefix; async
  request-hook failures and route-matching errors reach the existing error
  handler on both supported majors. Error mapping recognizes framework `status`
  as well as `statusCode`.
- Fastify routes and JSON parsers share one child scope. This fixes bodyless
  DELETE with ordinary JSON headers while preserving the host's custom parser.
  Prefixed 404 handling also uses connector hooks and error formatting. The
  three registration/schema tests now use real Fastify and fixture-owned
  resources; the old fake was deleted.

The initial expanded HTTP run had 27 failures. Subsequent focused tests caught
ignored unknown fieldsets, scalar document mismatch, prefix leakage, URI error
mapping and the bodyless DELETE mismatch. Real response-header inspection
confirmed the charset defect. The first full run then exposed 13 stale CORS
Vary expectations, all updated without removing their Origin assertions.

Final command: `npm run verify`, Node 22.16.0, SQLite, library base commit
`51302ce` plus the current goal worktree. Log:
`/tmp/library-http-full-verify-final.log`.

| Stage | Tests | Pass | Fail | Skipped tests | Duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| Full regular storage | 790 | 789 | 0 | 1 | 33.185 s |
| Full AnyAPI storage | 787 | 786 | 0 | 1 | 29.384 s |
| Express 4 / regular | 72 | 72 | 0 | 0 | 2.452 s |
| Express 4 / AnyAPI | 72 | 72 | 0 | 0 | 2.822 s |
| Lint | — | success | 0 | — | — |
| Documentation | — | success | 0 | — | 2.431 s |

Each full storage run includes 144 real HTTP cases, three real Fastify
registration/schema cases and six query-parser cases. No HTTP cases were
skipped. Earlier full-suite skip explanations still apply: Node's skipped-test
total does not include skipped suites, and legacy fixtures listed in the
conformance guide do not all switch storage modes.

Paired consumer command on Node 26.5.0:

```sh
node scripts/check-consumer-package.js --consumer /home/merc/Development/current/jskit-ai -- \
  npm test --workspace @jskit-ai/users-core --workspace @jskit-ai/workspaces-core \
  --workspace @jskit-ai/crud-core --workspace @jskit-ai/json-rest-api-core
```

All **352 tests** passed: users 43, workspaces 142, CRUD 144, host 23, no skips
or failures. jskit-ai HEAD remained
`70163546304ee1fed80cbf1c6ec67517294db855` with the existing migration worktree.
The packed library contained all runtime changes; SHA-256 was
`94f90ed0b1359e17c196266eeb84520a64fff192472e799dc0476517ecf375a7`.
The consumer's Knex peer was 3.2.10. Resolution was checked, the consumer's
dependency files were not mutated, and `/tmp/json-rest-consumer-q0baD1` was
confirmed removed. Log: `/tmp/library-http-consumer-final.log`. Evidence prose
was updated after packing; the runtime was unchanged.

The Fastify guide's actual `onBadUrl` example was extracted and executed:
malformed URL input produced 400, the exact JSON:API media type, and the expected
error document. This is optional host configuration, not evidence that plugin
hooks run for malformed URLs. Fastify's native boundary remains tested and
documented. Pre-parsing failures precede transport hooks; CORS behavior on those
responses remains part of A3-11. Real multipart, PostgreSQL/MySQL, further
query/serializer combinations, migration completion and final audits remain
open. The Express multipart detector import paths are still incorrect and will
be corrected with real detector coverage under A3-10.

A3-08/A3-09 are checked. Total **36/214 (16.8%)**: A29/138, B5/48, M2/14,
C0/14. This is progress on the full revised goal, not completion of that goal.

## 2026-09-09 — Native multipart parsers, resource writes and cancellation

Completed A3-10 using Busboy 1.6.0 and Formidable 3.5.4. The new
`tests/multipart-detectors.test.js` runs 20 cases through actual Node HTTP
streams. `tests/multipart-uploads.test.js` adds 24 resource cases through real
Express, local storage and the selected SQLite backend. Seven focused custom
detector/file-hook tests retain coverage of extension behavior. Tests cover
binary bytes and Unicode names, empty files, repeated text and duplicate file
fields, exact and exceeded limits, malformed input, concurrent requests,
prototype-like names, schema validation, rollback and disconnected clients.
Formidable cancellation waits for a nonempty temporary file before destroying
the client; cleanup preserves an unrelated sentinel file. Resource cancellation
also waits for the owned transaction rollback.

The initial selected native cases failed **10/10**
(`/tmp/library-multipart-before.log`). Real resource tests also exposed broken
detector imports and a missing canonical multipart input document. Production
fixes update Busboy factory/callback usage, propagate matched parser errors,
enforce bounded defaults, give each Formidable parse a private temporary
directory removed before return, and merge uploads into `context.inputRecord`.
Normal schema validation handles required files and PATCH omission. Unknown
file fields are rejected, numeric schema size limits work, and shared write
attribute collection preserves prototype-like names for normal validation.

Verification on Node 22.16.0:

| Command/job | Tests | Pass | Fail | Skipped | Duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| `npm run test:multipart`, regular | 51 | 51 | 0 | 0 | See focused log |
| `npm run test:multipart`, AnyAPI | 51 | 51 | 0 | 0 | 2.117 s |
| `npm run verify`, full regular | 837 | 836 | 0 | 1 | 33.055 s |
| `npm run verify`, full AnyAPI | 834 | 833 | 0 | 1 | 30.512 s |
| `npm run verify`, Express 4 regular | 96 | 96 | 0 | 0 | 2.617 s |
| `npm run verify`, Express 4 AnyAPI | 96 | 96 | 0 | 0 | 2.953 s |

Lint and the documentation build passed (2.502 s). Logs:
`/tmp/library-multipart-focused.log` and
`/tmp/library-multipart-full-verify.log`. Earlier skip explanations still apply:
Node's skipped-test count excludes skipped suites, and some legacy fixtures
listed in the conformance guide do not switch storage modes. Real multipart
coverage is Express; Fastify continues to reject multipart with 415.

The same paired consumer command recorded above passed **352/352** tests on
Node 26.5.0 (users 43, workspaces 142, CRUD 144, host 23; no failures/skips).
jskit-ai HEAD remained `70163546304ee1fed80cbf1c6ec67517294db855`.
The packed library SHA-256 was
`493abc46697fbed0d53ddbd1341368d1c408f60c69381e9cb4c5f0c313e42c7d`,
with consumer Knex 3.2.10. The runner verified actual package resolution and
unchanged consumer dependency files; `/tmp/json-rest-consumer-S9NnUh` was
confirmed removed. Log: `/tmp/library-multipart-consumer.log`. Later guide and
evidence edits do not change the runtime tested by that artifact.

The actual quick-start JavaScript from the rewritten file-upload guide was
executed with local dependency resolution, a private working directory and an
allocated loopback port. A multipart POST returned 201 and the stored URL
served the exact uploaded bytes. Server, database and temporary directory were
cleaned up. Log: `/tmp/library-multipart-guide-example.log`. The migration guide
documents installation order, bounded parser defaults, 400/413/422 errors,
duplicate-field rules and Formidable's buffered result without an ephemeral
path. Caller-owned transaction cleanup, replacement/deletion of committed
files, cleanup-error semantics and Socket.IO interactions remain A7/B2 work.

Verified total: **37/214 (17.3%)**: A30/138, B5/48, M2/14, C0/14.
This batch does not complete the full goal or its final review passes.

## 2026-09-09 — CORS response boundaries and failed header processing

This is verified progress within A3-11, which remains open for the deeper
Socket.IO rejection and relationship-event review. The total stays **37/214
(17.3%)**: A30/138, B5/48, M2/14, C0/14.

The new `tests/cors-transport.test.js` runs **55 tests** per full backend job:
28 actual Express cases and 27 actual Fastify cases. Express 4 also runs all
28 Express cases. Initial selected regressions failed **20/20**
(`/tmp/library-cors-before.log`): early responses lacked CORS, false async
origin decisions granted permission, zero preflight age was ignored, stateful
regex matching varied across requests, Vary fields were overwritten, and
preflight denial used an incompatible error envelope. A later interaction pass
added four initially failing cases where origin/response hooks failed while an
existing request error was being handled
(`/tmp/library-cors-secondary-before.log`). They now pass.

Both connectors reuse their existing context and response lifecycle for early
media/Accept/parser failures and explicit request rejection. Request hooks still
run after successful body parsing. Response hooks are attempted once; an error
from that chain is mapped without repeating its side effects. If the request
and its error-response hook both fail, the shared error boundary constructs an
AggregateError retaining both causes and sends a JSON:API error instead of
falling back to the framework's error format. Tests check the response-hook
attempt count, wire status/envelope and CORS headers.

CorsPlugin awaits origin decisions, caches one decision per response, respects
false/zero options, avoids mutating RegExp state, and varies reflected responses
for allowed, denied and absent origins. Its ineffective numeric hook order
option was removed: hooked-api 1.0.24 supports named before/after placement,
which the trace tests use explicitly. The shared header merger uses the
existing `vary` package's parser/append behavior (now a direct dependency at
1.1.2), preserving host/custom-route/hook fields and wildcard values. Existing
CORS assertions now compare Vary fields without depending on field order.
The prior HTTP rejection test was migrated to require response-hook headers.

Full verification on Node 22.16.0, log `/tmp/library-cors-full-verify.log`:

| Job | Tests | Pass | Fail | Skipped | Duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| Full regular SQLite | 892 | 891 | 0 | 1 | 34.691 s |
| Full AnyAPI SQLite | 889 | 888 | 0 | 1 | 34.049 s |
| Express 4 regular | 124 | 124 | 0 | 0 | 3.318 s |
| Express 4 AnyAPI | 124 | 124 | 0 | 0 | 3.388 s |

Lint and docs passed; the gate's documentation build took 2.611 s. Existing
mode-specific skipped tests/suites and legacy backend-fixed fixtures remain as
previously documented. The focused connector command now includes original
CORS, new CORS boundary and existing Socket.IO tests. Before the final five
boundary additions, that command passed **294/294 per backend** and **121/121
Express 4 per backend** (`/tmp/library-cors-matrix-next.log`). The final full gate
above includes those additions and the last error-handling fixes.

The same packaged jskit-ai verification command recorded above passed all
**352 tests** on Node 26.5.0, no failures/skips: users 43, workspaces 142, CRUD
144, host 23. HEAD remained `70163546304ee1fed80cbf1c6ec67517294db855`.
The runtime artifact SHA-256 was
`4445effbaa7d50d1c56576e761f354e92272c3a1dcb7ad5a39273d0998cae78c`,
with consumer Knex 3.2.10. Actual package resolution and unchanged dependency
files were checked by the runner; `/tmp/json-rest-consumer-qS31FQ` was confirmed
removed. Log: `/tmp/library-cors-consumer.log`. Later documentation/evidence
edits do not change the tested runtime. Searches of jskit-ai packages and the
two in-scope seed sources found no CorsPlugin/transport:response call sites
requiring migration in this batch.

The CORS guide was replaced with the tested configuration, actual defaults and
host boundaries. Its first JavaScript block was extracted and executed, changing
only dependency resolution and the listening port to local/allocated values.
Allowed preflight, resource POST, malformed-body response and denied preflight
all passed; the server/database were closed. Log:
`/tmp/library-cors-guide-example.log`. The API migration guide documents async
origin decisions, 403 error envelopes, early response hooks, once-only attempts
and Vary merging. Fastify's native malformed-URL error remains outside connector
hooks, explicitly tested and documented; raw host responses remain host-owned.

The Socket.IO inspection identified follow-up work under A3-11: prove native
connection/subscription rejection, replace a test's swallowed assertion and
fixed-delay event checks, and verify POST/DELETE relationship notifications.
The finish hook currently selects only resource CRUD method names; that path
needs an explicit relationship regression before changing event behavior.
Outer transaction outcome, notification visibility and cleanup guarantees remain
open under A2-10/A7/B1/B2, not established by this CORS batch.

## 2026-09-09 — Socket.IO subscription and write contracts

**A3-11 is complete**, including the preceding CORS work. The new
`tests/socketio-contract.test.js` runs 36 cases over each of WebSocket and polling,
using actual Socket.IO clients and servers: **72 cases per backend**, also run
with Express 4. The original twelve cases share bounded event waits and an
ordered server acknowledgement barrier. Negative checks collect events before
the write; a previous rejection assertion could swallow its own failure and
has been corrected. `npm run test:socketio` provides the focused two-backend
command; the full gate and Express 4 jobs include the contract file.

Initial selected cases failed **24/36** (`/tmp/library-socket-before.log`),
covering invalid filter containers, obsolete include/fields options, IDs,
asynchronous capacity races, duplicate restoration, multiple matching
subscriptions and missing POST/DELETE relationship notifications. Later
permission-revocation and JSON-encoding regressions each failed **2/2** before
their fixes (`/tmp/library-socket-permissions-before.log` and
`/tmp/library-socket-encoding-before.log`). Actual HTTP writes exposed the
WebSocket fixture's duplicate `/api` mount; it now uses the connector's mount
method. The initial HTTP cases failed **2/2** with 404 rather than 201
(`/tmp/library-socket-http-before.log`).

Subscription input now accepts only resource, filters and subscriptionId;
unused include/fields controls are removed. Filters use existing search-schema
validation, custom event predicates are awaited, and unsupported custom SQL
filters without an event predicate are rejected. Identity stays fixed across
the trusted admission hook. IDs are validated and unique, and capacity is
reserved before asynchronous room joining. Subscriptions are stored as an array
so the Redis adapter's JSON encoding retains them; this regression checks
serialization, not a live Redis cluster.

Each matching subscription receives its own event. Query permission is checked
again before notification; updates compare original and current records so
entry and exit both invalidate filtered results. Events use resource.created,
resource.updated and resource.deleted with string IDs. Relationship methods
expose their scope and reuse the already-read parent snapshot. POST/DELETE
relationship changes now notify the parent, while PATCH avoids duplicating the
inner resource update. Tests exercise child/parent events and rollback, inspect
committed transaction state, and verify successful HTTP writes and rejected
HTTP validation. Full row-policy/autofilter isolation is still A2-10 work.

Full `npm run verify` on Node 22.16.0 passed, log
`/tmp/library-socket-full-verify.log`:

| Job | Tests | Pass | Fail | Skipped | Duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| Full regular SQLite | 964 | 963 | 0 | 1 | 36.681 s |
| Full AnyAPI SQLite | 961 | 960 | 0 | 1 | 33.271 s |
| Express 4 regular | 196 | 196 | 0 | 0 | 3.967 s |
| Express 4 AnyAPI | 196 | 196 | 0 | 0 | 4.667 s |

Lint and docs passed; that documentation build took 2.258 s. Existing skipped
tests/suites and backend-fixed legacy fixtures remain as documented earlier.
After the gate, the HTTP test was adjusted to consume the response before
asserting status, avoiding an unread response on failure. Both focused HTTP
runs passed **2/2**, no failures/skips, in **1.218/1.394 s**
(`/tmp/library-socket-http-final.log` and
`/tmp/library-socket-http-anyapi-final.log`). This did not change runtime code.

Packaged consumer verification passed **352/352 jskit-ai tests** on Node 26.5.0:
users 43, workspaces 142, CRUD 144, host 23, no failures/skips. Consumer HEAD
remained `70163546304ee1fed80cbf1c6ec67517294db855`, using Knex 3.2.10.
Artifact SHA-256:
`e5929bb69bc3d8115af7826b36ea6c1b48aaa1f6844f34ae122097bd82eb7162`.
The runner checked actual package resolution and unchanged dependency files;
`/tmp/json-rest-consumer-4uRK90` was confirmed removed. Log:
`/tmp/library-socket-consumer.log`. Later documentation and test cleanup edits
do not change the tested runtime.

The rewritten Socket.IO guide's first JavaScript block was executed with local
dependency resolution and an allocated loopback port. A real client subscribed,
received the committed notification from HTTP POST 201, fetched the record with
HTTP GET 200, and unsubscribed successfully; socket, server and database closed.
Log: `/tmp/library-socket-guide-example.log`. The separate API migration guide
records removed options, event names, IDs and the actual admission-hook envelope.
Source searches in jskit-ai packages, vibe64 and its public/accounts seeds found
no SocketIOPlugin, startSocketServer, subscriptionFilters, subscription.update
or restore-subscriptions usage requiring migration in this batch.

Borrowed transaction outcomes, commit/rollback and notification failures,
queue cleanup, full row-policy isolation, custom SQL filter execution and live
Redis/startup cleanup remain open under the corresponding broader checklist
items. No exactly-once or durable delivery claim is made. Verified total:
**38/214 (17.8%)**: A31/138, B5/48, M2/14, C0/14. Final review passes remain open.

## 2026-09-09 — ID domains and mapped relationships

A2-05's shared matrix now includes **64 cases per backend** in
`tests/conformance-ids.test.js`, with actual mapped integer and string primary
keys. Tests cover zero IDs, all POST return modes, path/body consistency,
malformed values, stored column inspection, opaque identifiers, related reads,
linkage and nested includes across all supported relationship shapes. Existing
custom-ID and normalization suites supplement these cases; normalization now
also compares path/body IDs after plugin and resource overrides. The value
suite separately requires the positive-only `id` schema to reject zero and
negative IDs in both formats.

The initial zero tests used the positive-only `id` schema and were corrected to
use integer/string declarations before drawing conclusions about valid zero
writes. With the corrected fixture and explicit required child IDs, **15/21**
selected regular cases failed (`/tmp/library-ids-regressions-before.log`): plain
conversion dropped zero; PATCH/PUT replaced mismatching zero or invalid body IDs
with the path ID; plain belongsTo writes unlinked zero; reverse includes omitted
zero parents. Later opaque cases failed for `__proto__` and `constructor` in
regular storage and for `constructor` in AnyAPI
(`/tmp/library-ids-expanded.log`, `/tmp/library-ids-anyapi-expanded.log`).

The fixes reuse the existing request contracts and ID normalizer. Plain
conversion retains scalar types for validation; only null clears a to-one
relationship. Path IDs fill absent/undefined body IDs, never explicit zero or
invalid values. The default normalizer rejects implicit object/boolean IDs;
error construction also avoids invoking an invalid object's string conversion.
That final error-boundary regression failed **2/2** before its fix
(`/tmp/library-ids-error-boundary-before.log`). The original whitespace and
resource-specific normalization behavior remains covered.

ID-indexed relationship lookups now use null-prototype dictionaries. Zero SQL
values remain eligible for includes and polymorphic minimal records. Pivot
owner IDs use the same string ID domain as related identifiers. A mapped pivot
exposed `integer` declarations falling through to string columns: creation,
migration generation and migration-diff classification now recognize integer
fields. A real SQLite test executes generated up/down migrations, verifies
column types and stored numeric values, and checks the signed integer's diff;
it does not claim unsigned enforcement or PostgreSQL/MySQL proof. AnyAPI PUT
validation now recognizes supplied polymorphic fields already extracted from
relationships rather than demanding duplicate attribute input.

The real connector file adds six path/body rejection cases across return
settings and eight native HTTP link-following cases per backend. A punctuation
and Unicode ID initially caused POST to commit and then fail with an invalid
Location header. Resource/relationship URL generation and the default Location
helper now share path-segment encoding. Tests follow returned Location, self,
linkage and related URLs through actual Express 5/Fastify 5; Express 4 runs seven
of the added cases. Missing reverse link properties in the first test draft were
corrected to follow the actual relationship endpoint's links; no new reverse
link requirement was inferred from that test assumption.

The focused `npm run test:id-contracts` command passed **96/96 regular** and
**92/92 AnyAPI**, no failures/skips, **2.721/3.229 s**
(`/tmp/library-ids-command-final.log`). The first full run passed all test jobs
but stopped at lint on two test formatting errors. After those were corrected,
a later AnyAPI run found an intermittent Formidable upload cancellation wait:
the test inspected partial bytes only after a filesystem event. A deterministic
regression with bytes already written failed **1/1** using that observer
(`/tmp/library-ids-upload-observer-before.log`). The test helper now polls actual
file state within the existing abort deadline; cancellation still requires real
partial bytes, followed by cleanup and rollback. No production upload behavior
or timeout was changed.

The final packaged jskit-ai check passed all **352 tests** on Node 26.5.0: users
43, workspaces 142, CRUD 144, host 23, no failures/skips. HEAD remained
`70163546304ee1fed80cbf1c6ec67517294db855`, with consumer Knex 3.2.10. Runtime
artifact SHA-256:
`9c988c7f2692360b903fe2e0a9833ce20bc3d28ba6d4576ac591592d47bc311b`.
The runner verified actual package resolution and unchanged dependency files;
`/tmp/json-rest-consumer-eYWSeX` was confirmed removed. Log:
`/tmp/library-ids-consumer-final.log`. Later changes were test observation and
prose only, so that artifact contains the final runtime. Source searches of
jskit-ai, vibe64 and its public/accounts seeds found no table/migration-helper
calls requiring an integer-column data conversion. jskit-ai's configured ID
normalizer remains in place and is tested by its host suite.

The [migration guide](../GUIDE/MIGRATING_API_V2.md#resource-ids-and-links) explains
scalar input, null/zero distinctions, explicit invalid body IDs, encoded URLs,
integer column generation and review of any pre-existing string columns.
Real database/schema capability matrices and all broader transaction, policy,
consumer/dependency and final review work remain open.

Final `npm run verify` passed on Node 22.16.0
(`/tmp/library-ids-final-gate.log`):

| Job | Result | Duration |
| --- | --- | --- |
| Full regular SQLite | 1045/1046 passed, zero failures, one existing skip | 31.500 s |
| Full AnyAPI SQLite | 1042/1043 passed, zero failures, one existing skip | 35.194 s |
| Express 4 regular | 203/203 passed, no failures/skips | 4.636 s |
| Express 4 AnyAPI | 203/203 passed, no failures/skips | 6.310 s |
| Lint | Passed | — |
| Documentation build | Passed | 2.420 s |

The existing mode-specific skipped suites and backend-fixed fixtures remain
as previously disclosed; these totals do not imply every test runs against
both storage modes. A separate exact-pattern run exercised five actual
detector/HTTP cancellation and existing-partial-bytes observer cases on each
backend: **5/5 regular**, **5/5 AnyAPI**, no failures/skips, **2.332/2.494 s**
(`/tmp/library-ids-cancellation-knex.log`,
`/tmp/library-ids-cancellation-anyapi.log`).

A2-05 is now checked. Verified total: **39/214 (18.2%)**:
**A32/138, B5/48, M2/14, C0/14**. Checklist completion is not an estimate of
remaining effort or the proportion of library code rewritten.

## 2026-09-09 — Shared temporal values and AnyAPI serialization

Added `conformance-temporal` using the existing conformance and temporal
fixtures: **64 cases per selected backend**, including 57 public/storage cases
and seven direct normalization cases. The [coverage map](conformance.md#temporal-values-transformations-and-serialization)
describes values, formats, write-return modes, transformation paths, stored
representations and limits. DateTime precision and public expected values are
explicit; SQLite representation tests are not claimed as real-driver coverage.

The initial matrix used nonexistent `cursor.prev` metadata, assumed scalar
search declarations also accept arrays, and omitted declared relationship
linkage from a plain sparse-response expectation. Those test assumptions were
corrected before classifying regressions. The corrected run passed **60/60
regular** and **56/60 AnyAPI**; the four AnyAPI failures demonstrated that its
write path bypassed custom serializers (`/tmp/library-temporal-knex-regressions.log`,
`/tmp/library-temporal-anyapi-regressions.log`).

AnyAPI's descriptor metadata discards functions during persistence; rehydration
now retains callable nested storage metadata from the compiled resource. Both
storage mappers reuse a small serialization-choice helper in the existing
storage-mapping module. AnyAPI now supplies real write context and operation
names and uses its storage adapter for cursor comparisons. Its private filter
pass duplicated the shared filter hooks and performed incompatible temporal
coercion; it and its three unused coercion/validation exports were removed.
Source searches found no imports of those exports in jskit-ai, vibe64 or its
public/accounts seeds. The migration guide documents the removed deep exports
and the serializer callback contract.

After the serializer fix, the selected temporal/storage suites passed **86/86
regular** and **81/81 AnyAPI**, with the historical AnyAPI serializer skip
removed (`/tmp/library-temporal-knex-fixed.log`,
`/tmp/library-temporal-anyapi-fixed.log`). Additional callback assertions verify
one serialization per filtered query and context/operation metadata for writes.
Their first draft expected an uppercase context method; it was corrected to
the existing lowercase method contract.

Explicit UTC range tests then reproduced server-side temporal errors for
`0000-01-01T00:00:00+01:00` instead of client validation errors: two failures
among four focused cases on each backend (`/tmp/library-temporal-range-before.log`,
`/tmp/library-temporal-range-anyapi-before.log`). Built-in storage now rejects
UTC years outside 0000–9999 before writing. Both extremes are covered across
POST/PUT/PATCH, plus no/minimal-return POST rejection with zero stored rows.

The new `npm run test:temporal` command passed **140/140 regular** and
**135/135 AnyAPI**, zero failures/skips, **4.374/7.241 s**
(`/tmp/library-temporal-focused-final.log`). It includes shared temporal values,
historical boundaries and getter/setter/computed suites; only the regular job
includes the historical regular-only storage-mapping file. Initial lint found
18 formatting errors in the new edits, corrected with the existing ESLint rules.

Final `npm run verify` passed on Node 22.16.0
(`/tmp/library-temporal-full-gate.log`):

| Job | Result | Duration |
| --- | --- | --- |
| Full regular SQLite | 1109/1110 passed, zero failures, one existing skip | 39.122 s |
| Full AnyAPI SQLite | 1107/1107 passed, no failures/skips | 38.041 s |
| Express 4 regular | 203/203 passed, no failures/skips | 5.572 s |
| Express 4 AnyAPI | 203/203 passed, no failures/skips | 6.087 s |
| Lint | Passed | — |
| Documentation build | Passed | 2.736 s |

AnyAPI's former skipped temporal serializer case now executes and passes.
Previously disclosed mode-specific skipped suites and backend-fixed fixtures
still limit the full-suite matrix; zero skipped individual AnyAPI tests does
not mean every file exercises both backends.

The final packed library passed **352/352 jskit-ai tests** on Node 26.5.0: users
43, workspaces 142, CRUD 144, host 23, zero failures/skips. HEAD was rechecked as
`70163546304ee1fed80cbf1c6ec67517294db855`, using Knex 3.2.10. The host tests
include existing native temporal-value and symbolic serializer contracts.
Artifact SHA-256:
`baa345dd8c53b2a997a28d8ca37dc9c9935fae3b6059b5290f98866659eefa13`.
The runner verified actual resolution and unchanged consumer dependency files;
`/tmp/json-rest-consumer-pMsF67` was confirmed removed. Log:
`/tmp/library-temporal-consumer.log`. Only prose changed after the packed runtime.

A2-07 is now checked. Verified total: **40/214 (18.7%)**:
**A33/138, B5/48, M2/14, C0/14**. Actual PostgreSQL/MySQL temporal and schema
capabilities, broader filter/policy/transaction contracts, coordinated consumer
dependencies and all final reviews remain open.
