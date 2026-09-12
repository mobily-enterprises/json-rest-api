# Final developer-experience work

The initial phase implemented the agreed hook-guidance and schema-typing
improvements, preserving the existing JavaScript resource API, shared mutable
operation context, permissions, storage, transactions and nested response reads.
The separately authorized feature work is recorded below. Consumer migrations
remain paused; consumer source inspection is read-only.

## 1. Make the existing hook contract easier to use

- [x] Add useful declarations for known hook phases and their available context fields.
- [x] Describe library-owned fields as read-only where appropriate while retaining writable input, output and custom application state.
- [x] Type permission/enrichment wrappers and their references to the operation context.
- [x] Keep an explicit route for custom/plugin hooks without constructing a type-level lifecycle framework.
- [x] Provide practical recipes for input preparation, permission caching, output enrichment and after-commit work.
- [x] Verify hook declarations with positive and negative type cases and execute the affected recipes.

## 2. Infer useful resource types from existing schemas

- [x] Describe built-in schema fields, relationships and resource options for autocomplete and typo detection.
- [x] Infer ordinary public input/output value types from literal schema declarations.
- [x] Preserve differences between writable/computed fields, nullable values and potentially omitted response fields.
- [x] Keep explicit input/output types for dynamic plugins and custom transformations; do not require caller fields supplied by hooks/defaults.
- [x] Infer the handle returned by existing `addResource()` calls without introducing a new schema language or registration builder.
- [x] Preserve explicitly typed resource registries and document inference limits and configured defaults.
- [x] Add meaningful wrong-field/wrong-value and accepted-customization type checks, including the packed public package.
- [x] Update API documentation, examples and the migration guide with the final supported typing contract.

## Acceptance

- [x] Review the declarations for complexity and claims stronger than runtime guarantees.
- [x] Pass Node 24 type checks, packed public checks, affected documentation checks, lint and documentation build.
- [x] Record verification and any remaining limitations here; avoid repeating the comprehensive runtime/database suites for declaration-only work.

No new runtime API or runtime behavior change is planned. If implementation
reveals one is necessary, record the concrete reason before proceeding.

## Result and verification

Completed both parts without changing runtime JavaScript. The runtime remains
169 lines. New declarations describe existing behavior; input/output inference
uses the existing `addResource()` return value. No new schema language, runtime
wrapper, immutable context or plugin framework was introduced. Changes remain
uncommitted alongside the earlier input/context work.

Verified on Node 24.6.0:

- `npm run typecheck`: passed, including schema, registration and hook positive
  and negative cases. Tests cover schema typos, optional SQL nulls, computed and
  hidden fields, literal/dynamic IDs, explicit registries, custom hooks, readonly
  operation identity and nested writes with managed transactions.
- `npm run test:public-types`: passed against the tarball: 167 files, 435,999
  packed bytes, 249 documentation links, 29 runtime exports and 24 rejection
  checks. Package SHA: `f244705d52e40958adafb09660a275c2d6006606`.
- `npm run test:api-reference`, `npm run test:tutorial-guides` and
  `npm run test:migration-guide`: passed. Applicable examples ran against both
  SQLite storage layouts. Hook recipes also verify denied writes, rollback,
  cached permissions, sparse output and after-commit timing.
- `npm run lint`, `npm run docs` and `git diff --check`: passed. Generated-site
  verification checked all 39 pages with no broken local targets, anchors,
  assets, duplicate IDs or primary-heading issues.
- Comprehensive runtime/database suites were not repeated: their underlying
  implementations were unchanged by this work. Logs are under
  `/tmp/jra-last-todo-*` and `/tmp/jra-hook-recipes.log`.

## Deliberate typing limits

Known hook declarations provide editor guidance, not a proof of authorization or
transaction completion. Early document input and arbitrary attribute values need
narrowing. Application state remains mutable; readonly annotations express
ownership and do not freeze runtime objects. Ordinary CRUD permissions use a
wrapper; relationship permission hooks receive the operation directly.

Attribute inference handles ordinary declared values. Explicit resource models
remain available for dynamic enrichment, method replacements, custom API-level
defaults, relationship result shapes, polymorphic backing fields, managed
version-field input restrictions and callback/serializer output. Literal
resource defaults and physical IDs are understood; dynamic physical ID names
fall back to a general resource instead of weakening field checking. A typed
central `api.resources` registry still uses the explicit resource-map generic.

The first two sections above are complete. The follow-up decisions below were
authorized separately. jskit-ai, vibe64 and their seeds remain untouched.

## Follow-up: useful features and supported boundaries

- [x] Delete the mock S3 adapter, its exports, declarations and dedicated tests; retain local storage and the application-owned adapter interface.
- [x] Document S3 removal in the API migration guide.
- [x] Retain the SQL focus; do not introduce a speculative remote/NoSQL abstraction.
- [x] Trace json-rest-api's actual schema/migration function usage in jskit-ai, Vibe64, its selected seeds and available app source, including the five identified remote canonical apps; record evidence and coverage limits.
- [x] Retain useful schema helpers and fix reproduced diff safeguards, with focused regressions.
- [x] Review optional features, unused helpers and stale dependencies; distinguish removals from useful extension points.
- [x] Improve positioning concurrency for drag-and-drop and verify independent connections on supported databases.
- [x] Explain managed transaction ownership and savepoint limits; retain the existing ownership contract.
- [x] Offer MIT OR GPL-3.0-or-later, including both complete license texts and package metadata.
- [x] Add reproducible permission/include and transaction stress workloads with correctness/query budgets and observed latency/memory.
- [x] Review final changes and run affected type, package, documentation and focused runtime checks on Node 24.
- [x] Record results, decisions and remaining limits here.

Consumer migration evidence is in `old/consumer-migration-feature-usage.md`.
The inspected local consumers and all five identified remote canonical apps
(`sas/dogandgroom`, `sas/compas-next`, `sas/racing`, `pass/whs2` and
`matt/beepollen`) use authored Knex migrations. No calls to json-rest-api's six
schema/migration helpers, relevant deep imports or AnyAPI setup were found in
their inspected application source or installed JSKIT runtime packages. The
remote investigation used the matching access guidance in
`vibe64-online/AGENTS.md`; the suggested `jskit-ai-online` checkout was absent.

The most recent materialized source checkout for each remote app matched the
inspected canonical commit. Recorded current deployment artifacts were also
inspected for DogAndGroom, CompAS and BeePollen, including older framework
versions; their helper usage was also absent. Racing and WHS2 had no current
deployment pointer in the inspected state. The report distinguishes these
snapshots and versions. This is source and installed-package evidence, not an
audit of running processes or proof that a command was never run historically.
The installed applications use earlier library releases, not this revised
checkout.

Canonical storage's allocation and bootstrap functions are a different, live
internal path. Useful schema helpers are retained; generated diffs remain
developer-reviewed drafts, not automatic schema synchronization or a
migration-history system. No current consumer dependency on diff generation was
established, and no new migration runner is needed for these applications.

Initial probes reproduced unrequested index/foreign-key removals without
warnings, incomplete SQLite index snapshots, and missing warnings for a required
new column and bigint narrowing. These findings justify a bounded safeguard fix,
not a new migration framework. Consumers were only read, never executed or edited.

The unused-surface report is `old/unused-surface-audit.md`. Removed the unused
direct `semver` dependency and unused optional peers `raw-body` and `jose`; kept
`jose` as a development dependency for JWT fixtures. The offline lock refresh
changed dependency classifications without updating resolved package versions.
The report records further internal-helper candidates for a separate cleanup
decision; optional public integrations remain supported.

Stress verification on Node 24 passed the default workload in both SQLite
layouts: 200 reads and 32 writes each, zero runtime metadata queries and zero
unattributed statements. Read maximum was 8 SQL statements; write maxima were
10 for ordinary storage and 9 for canonical storage. Each run verified 16 commit
and 16 rollback completions. A smaller three-batch GC run also passed both
layouts (60 reads, 24 writes each); 16 invalid configurations failed before
database setup. Reports: `/tmp/jra-stress-final-{knex,anyapi}.json` and
`/tmp/jra-stress-soak-{knex,anyapi}.json`. These are bounded workload checks and
measurements, not evidence of production scale or absence of every memory leak.

Migration safeguards now preserve undeclared indexes/foreign keys by default,
require boolean opt-ins for their removal, reject retained column dependencies
(including self-referencing foreign keys), and warn about replacement, backfill
and bigint narrowing. Known unrepresentable indexes and generated columns reject
full snapshots. Warning comments cannot escape into generated executable source.
Independent review found the self-reference case and confirmed the corrected
reviewed-draft boundary. Remaining dialect/model limits are explicit in GUIDE21.

Final affected SQLite schema run: 155/155 passed. PostgreSQL schema/field checks:
76/76 plus the later dependency/self-reference checks 3/3. The initial MySQL
schema/field run had 65 passes and one new test-assertion mismatch; that assertion
was isolated correctly and passed on rerun. The final 11-case MySQL selection
also passed, covering added snapshot rejection, dependencies and warnings.
Logs are `/tmp/jra-migration-safeguards-*` and
`/tmp/jra-migration-dependencies-*`; no comprehensive suite was repeated.

Positioning now uses a transaction-owned coordinator row per resource. The main
plugin shrank from 618 lines to 210. Group moves, PUT, target permissions,
rollback, physical index creation, valid keys and declared length limits have
focused coverage. Independent review caught rounded SQLite IDs in neighbor
selection; allocation now uses position bounds, and group reads reuse the
existing lossless identity expression and native read options. Final selected
checks passed 17/17 on all three databases in both layouts: 102 passes, no skips.
Earlier historical and native positioning checks also passed. Final logs include
`/tmp/jra-positioning-exact-sqlite*.log`,
`/tmp/jra-positioning-exact-{pg,mysql2}-final.log`, and
`/tmp/jra-followup-positioning-lint-final.log`.

Positioning requires bytewise column collation for ordinary sorting/cursors,
serializes writes per resource, and leaves retries and offline rebalancing to
the application. The lock table must be provisioned when runtime DDL is forbidden.
The no-op `reorder` helper and inert `rebalanceThreshold` option were retired;
the migration guide describes these and the low-level position-helper change.

Local final verification passed on Node 24.6.0: type checking, packed public
declarations/contents (28 runtime exports after S3 removal), API and migration
examples, the file guide under Express 5 and 4, and the literal positioning
guide. The documentation site rebuilt successfully; all 39 generated pages
have valid local links/anchors/assets and heading structure. Global lint found
only six positioning style issues; those were fixed and the affected files
passed focused lint. `git diff --check` is clean.

The clean-package check first exposed one stale export-count assertion from S3
removal (29 instead of 28); after correcting that test, the fresh installation
passed core imports without optional peers and ordinary/canonical CRUD. Its
tarball SHA was `63f79885837dcf7076e1859bf51ab1ebce906466`. A subsequent one-line
documentation note explains the private position-helper signature; site checks
were repeated for that prose change. The native SQLite dependency compiled from
source in the isolated consumer. All local test/install processes completed.
Logs: `/tmp/jra-followup-*`. No full runtime matrix was repeated, and no consumer
repository, application database, deployment or migration was changed.

## What remains of the adoption assessment

The original independent assessment remains unchanged in
`old/technical-adoption-assessment.md`. Schema-derived attribute typing,
positioning concurrency, the S3 demo and licensing choice have concrete
implementation changes. Hook types and recipes reduce the learning burden but
do not eliminate phase-specific mutable state, wrapper distinctions or nested
read behavior. SQL focus and managed transaction ownership remain deliberate
boundaries. Diff generation remains a reviewed draft, not migration history.

The public input/output contract is clearer; sustained API stability still
requires actual consumer use of this revised version. Existing applications use
earlier library versions. Stress workloads add reproducible correctness and
performance evidence, not production history or maintenance longevity for the
revised implementation, nor evidence of broader community adoption. Those
outstanding questions are not additional framework features to implement.
Independent review agrees that ordinary attribute inference is substantially
improved; central resource registries and relationship result models still need
explicit declarations. Shared direct/HTTP behavior, relationship-aware
permissions, include loading and explicit transaction outcomes remain the
library's principal value.
