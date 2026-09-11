> Archived revision 1, preserved on 2026-09-09. This is historical evidence, not an active checklist. Follow the root `library-improvement-plan.md` revision 2. Its compatibility constraints have been superseded by the maintainer.

# Library improvement execution plan

Created: 2026-09-08.

Starting reference: `51302ce` (`1.0.29`), following the temporal, fieldset, error-propagation, and pagination fixes in `24ea75e`. Confirm the actual checkout before implementation; other work may have advanced it.

## Objective and scope

Improve correctness, maintainability, backend consistency, performance, and release confidence while preserving existing resource declarations, methods, payloads, imports, configuration defaults, and hook behavior.

This plan implements all seven internal improvements discussed with the maintainer. The four proposed API additions are tracked separately in Part B. They must be additive or opt-in. Existing callers must continue working without migration.

The lifecycle work is a modest refactor of ordinary functions. Extend the existing shared helpers, keep POST/PUT/PATCH and relationship semantics visible, and extract only genuinely repeated sequences. Each extraction must make its callers easier to understand.

## Checklist and evidence rules

- Every execution item has a stable identifier. Mark it `[x]` only after its acceptance condition is met.
- Record evidence in the execution log: files, relevant tests or commands, results, and any compatibility decisions.
- Existing functionality can satisfy an item when inspection and tests demonstrate that it already meets the requirement. Do not reimplement completed work from `fixing_plan.md` or `SINGLE_VALIDATION_CONTRACT_TODO.txt`.
- An unavailable database, skipped integration job, or unfinished API addition remains open. Explain the limitation and continue independent work.
- If an item proves unnecessary, record the evidence and its equivalent completed outcome. Do not mark a deferred feature complete.
- New findings become identified checklist items with a regression case; keep unrelated feature expansion outside this plan.
- Follow `AGENTS.md`: ESM, named exports for new modules, two-space indentation, shared fixtures and assertions, and strict JSON:API tests except where simplified mode is the subject.
- This goal covers local implementation, verification, documentation, and a final report. Remote publishing and deployment are not completion requirements.

## Compatibility and simplicity constraints

- Preserve `addResource`, existing resource methods, relationship endpoints, plugin entrypoints, and supported imports.
- Preserve option precedence, boolean return-record aliases, default formats, custom ID behavior, URL generation, and existing transport contracts.
- Treat hook names, order, invocation counts, context contents, mutation opportunities, and transaction timing as public behavior.
- Preserve caller-owned transaction behavior. Any new managed transaction behavior must be explicitly selected.
- Keep `json-rest-schema` as the authored validation source and derive connector schemas from it. Keep authorization and database existence checks imperative.
- Use existing field normalization and representation helpers. Do not duplicate field conversion rules or normalize by serializing and reparsing JSON.
- Use a small number of plain functions and data objects. Do not introduce a pipeline registry, operation DSL, generic middleware engine, or new ORM.
- Leave method-specific validation and relationship decisions in the relevant methods. A helper needing many mode flags is a signal to keep those parts separate.
- Introduce abstractions only when actual callers and tests demonstrate their benefit. Splitting a large file is not by itself a completed improvement.
- Keep caches scoped to the correct resource, configuration version, tenant, and request. Never share authorization-dependent results across callers.
- Avoid silently narrowing import paths, supported configurations, or established extension hooks while cleaning up internals.

## Milestones and dependencies

| Milestone | Work | Prerequisites | Completion evidence |
| --- | --- | --- | --- |
| M0 | Baseline and compatibility inventory | None | A0 recorded against the actual checkout |
| M1 | Complete verification gate and shared conformance tests | M0 | A1–A2 pass on both storage modes |
| M2 | Real database and connector coverage | M1 | A3 runs on SQLite, PostgreSQL, MySQL, and real HTTP connectors |
| M3 | Small lifecycle refactor | M1; relevant M2 cases before merging backend-sensitive changes | A4 preserves hook traces and public behavior |
| M4 | Compiled schema and storage contracts | M1, M3, relevant real database coverage | A5–A6 remove demonstrated duplication |
| M5 | Failure semantics, query budgets, internal types | M3; M4 where applicable | A7–A9 have verified invariants and measurements |
| M6 | Additive API capabilities | Corresponding Part A foundations | B1–B4 pass enabled and legacy-default tests |
| M7 | Documentation, package verification, final review | All preceding applicable work | A10 and C complete; evidence-backed final report |

Execute small, reviewable changes within each milestone. Documentation and typing can accompany earlier changes. Do not combine the entire roadmap into one refactor.

## Starting observations to verify

These are planning evidence, not newly completed execution items:

- The last recorded full runs after `24ea75e` passed 485 regular-backend tests and 482 AnyAPI tests, with one skipped test in each run, using Node 22 and SQLite.
- `npm run verify` currently runs the ID-focused tests and documentation, rather than both full suites and lint.
- `tests/curl.test.js` uses fixed port 3456. Concurrent full-suite runs previously conflicted.
- Fastify parity tests currently use `tests/helpers/fake-fastify.js`.
- `eslint.config.js` excludes tests and examples.
- `common.js` already contains `setupCommonRequest`, `validateResourceAttributesBeforeWrite`, `applyFieldSetters`, `handleRecordReturnAfterWrite`, `handleWriteMethodError`, and `commitOwnedTransaction`.
- Both storage plugins implement substantial query behavior. AnyAPI also wraps Knex builders with method interception.
- A related-resource fallback calls `get` once per related ID in `get-related.js`.
- A package dry run included tests, development notes, and agent instructions. Preserve supported code imports when restricting published files.

# Part A — Improvements preserving the existing API

## A0. Establish the baseline and compatibility inventory

Primary files: `index.js`, `package.json`, `AGENTS.md`, `tests/`, existing audit trackers, and the resource methods and plugin hooks.

- [x] **A0-01** Record the starting commit, working-tree changes, installed package versions, Node version, and native SQLite compatibility. Preserve unrelated work.
- [x] **A0-02** Reconcile the earlier audit trackers with current code. Identify already completed work and stale descriptions; link to it rather than recreating it.
- [x] **A0-03** Run the current full regular and AnyAPI suites separately and record tests, passes, skips, failures, and durations. Preserve a reproducible baseline for any existing failure.
- [x] **A0-04** Run current lint and documentation builds. Record exactly what each command covers.
- [x] **A0-05** Inventory public exports, supported deep imports, method arguments, response formats, option precedence, and documented extension hooks.
- [x] **A0-06** Inventory supported backend/driver combinations and capability differences, including custom serializers, temporal precision, custom IDs, relationship operations, and migrations.
- [x] **A0-07** Map the read/write and relationship lifecycles, including nested GETs used for full write responses, bulk calls, transaction ownership, and file/Socket.IO hooks.
- [x] **A0-08** Record a representative query-count and package-content baseline for comparison during A8 and A10.

Acceptance: implementation starts with an explicit compatibility reference and reproducible checks, not assumptions based on earlier test counts.

## A1. Make verification complete and reproducible

Primary files: `package.json`, `eslint.config.js`, `tests/curl.test.js`, test helpers, development scripts, and new CI configuration where appropriate.

- [x] **A1-01** Define a supported Node range from actual dependency support and verification; document it and provide a consistent development runtime configuration.
- [x] **A1-02** Replace fixed test-server ports with allocated ports and propagate the actual address to curl and other clients.
- [x] **A1-03** Ensure servers, subprocesses, temporary files, database connections, and registries are cleaned up after success and failure. Add bounded subprocess timeouts where absent.
- [x] **A1-04** Remove test-order dependence caused by shared tenant/fixture state. Confirm isolated files and complete suites observe the same behavior.
- [x] **A1-05** Make `npm run verify` run both full suites, lint, documentation, and the additional checks introduced by this plan. Keep focused commands available for development.
- [ ] **A1-06** Add explicit commands for conformance, real-driver integration, real-connector integration, type checking, and package checks as those capabilities land. Each failure must produce a nonzero exit status.
- [x] **A1-07** Extend lint coverage to maintained tests and scripts, resolving relevant findings without an unrelated repository-wide formatting rewrite.
- [ ] **A1-08** Add CI jobs for the supported Node versions and appropriate database/connector matrix. Use isolated disposable databases and explicit service readiness checks.
- [x] **A1-09** Document one reproducible clean-checkout verification sequence and the required local services/tools. Do not require private credentials for the standard suite.
- [x] **A1-10** Verify the complete gate detects a deliberately introduced local failure, then remove that temporary change. Capture skipped capability coverage explicitly.

Acceptance: the advertised verification command exercises the full maintained contract, failures cannot be mistaken for success, and test servers do not conflict.

## A2. Build a shared behavioral conformance suite

Primary files: `tests/fixtures/api-configs.js`, `tests/helpers/`, existing contract suites, and focused new conformance suites.

- [x] **A2-01** Define a small fixture interface for backend setup, resource configuration, cleanup, seeding, inspection, and teardown. Keep resource registration in fixture modules.
- [x] **A2-02** Run identical public-behavior assertions against regular storage and AnyAPI. Parameterize the backend instead of copying test bodies.
- [ ] **A2-03** Cover GET/query/POST/PUT/PATCH/DELETE and all relationship endpoints, including PUT creation and replacement semantics.
- [ ] **A2-04** Cover strict and simplified formats, transport versus programmatic defaults, per-call overrides, and no/minimal/full write returns.
- [ ] **A2-05** Cover numeric and opaque IDs, custom `idProperty`, ID normalization, custom column mappings, and path/body ID consistency.
- [x] **A2-06** Cover missing, undefined, null, false, zero, empty-string, defaulted, virtual, hidden, and normally-hidden field behavior where applicable.
- [ ] **A2-07** Cover date/dateTime/time, epochs, precision, offsets, SQL driver values, getters, setters, computed fields, and custom serializers with explicit expected public values.
- [x] **A2-08** Cover belongsTo, hasOne, hasMany, many-to-many, polymorphic and nested includes, empty relationships, cycles, and repeated references where supported.
- [ ] **A2-09** Cover filters, sparse fields, query projections, sorting, pagination modes, caps, nullable sort values, duplicate keys, and generated-link round trips.
- [ ] **A2-10** Cover authorization, autofilters, and row policies on primary records, includes, relationship linkage, counts, pagination, and bulk operations. Assert that denied rows do not leak through any representation.
- [ ] **A2-11** Define independent invariants for successful writes, rejected writes, atomic bulk operations, relationship integrity, typed errors, and final response normalization.
- [x] **A2-12** Add generated cases with deterministic seeds and failure shrinking for field values, sort combinations, page sizes, and relationship shapes. Reuse the existing test runner.
- [x] **A2-13** Add generated operation sequences against a small independent state model: create, update, relate, query, and delete. The model must not call production normalization or query code to calculate expectations.
- [x] **A2-14** Assert complete pagination traversals return the expected records once each on an unchanged dataset; cover forward and backward traversal and tied/null sort values.
- [x] **A2-15** Preserve seed/replay information for generated failures and turn confirmed regressions into small permanent examples.
- [ ] **A2-16** Map each supported capability to executed tests. List real backend limitations explicitly rather than weakening shared assertions to make results agree.

Acceptance: matching backends must also satisfy independently defined behavior. Passing by sharing the same mistake is insufficient.

## A3. Test real databases and real HTTP connectors

Primary files: integration fixtures and scripts, `tests/fastify-plugin.test.js`, `tests/http-connectors-parity.test.js`, database capability helpers, and CI configuration.

- [ ] **A3-01** Provide disposable PostgreSQL and MySQL integration environments, plus SQLite, with isolated database/schema names and reliable teardown.
- [ ] **A3-02** Run both storage modes against each supported database combination. Mark a combination unsupported only when its limitation is explicit and documented.
- [ ] **A3-03** Exercise actual driver behavior for temporal fields, high-precision input, time-only values, epochs/bigints, booleans, null ordering, and serialization comparisons.
- [ ] **A3-04** Exercise custom IDs, generated IDs, insert/returning fallbacks, qualified joins, aliases, parameter binding, count queries, and pagination SQL.
- [ ] **A3-05** Exercise schema creation, introspection, migration generation, static/function defaults, and storage mappings on real databases.
- [ ] **A3-06** Exercise commit/rollback, concurrent connections, isolation-sensitive updates, and relationship integrity with actual transactions.
- [ ] **A3-07** Instantiate real Fastify for integration tests and use its actual validation, routing, parsing, serialization, and error handling. Retain small fakes only where they serve a focused unit-test purpose.
- [ ] **A3-08** Run connector conformance through actual Express and Fastify request handling, including the advertised supported major versions.
- [ ] **A3-09** Compare real connector and in-process behavior for malformed bodies, query coercion, content types, errors, headers, links, response formats, and relationship routes.
- [ ] **A3-10** Test real multipart detector APIs for valid uploads, limits, malformed input, cancellation, and cleanup; avoid relying solely on hand-written detector fakes.
- [ ] **A3-11** Include CORS and Socket.IO contract tests in the verification matrix, particularly request rejection and events associated with writes and relationship changes.
- [ ] **A3-12** Make required CI integration jobs fail when their services or tests are unavailable; document how local runs report a deliberately omitted integration environment.

Acceptance: SQLite, fake-server behavior, or SQL string assertions alone do not establish cross-driver and connector compatibility.

## A4. Refactor the operation lifecycle without introducing a framework

Primary files: `plugins/core/rest-api-plugin-methods/common.js`, resource methods, relationship methods, and lifecycle tests.

The first candidate extraction is the repeated sequence of before-data hooks, field setters, the storage call, and after-data hooks. Inspect the actual methods before deciding its final signature. Supply the storage operation as an ordinary function; keep creation/update-specific results visible at the call site.

- [ ] **A4-01** Document the exact current hook order and context guarantees for each operation, including hooks invoked by nested reads during full write responses.
- [ ] **A4-02** Add trace tests for POST, PUT-create, PUT-update, PATCH, and DELETE covering hook names, order, counts, and awaited completion.
- [ ] **A4-03** Add corresponding trace tests for relationship writes and bulk operations, including owned and borrowed transactions.
- [ ] **A4-04** Verify hook-observable IDs, original/input/current attributes, minimal records, response records, method values, auth context, and transaction identity.
- [ ] **A4-05** Inject failures at each existing lifecycle stage and assert which later hooks must not run, whether data changes, and which error reaches the caller.
- [ ] **A4-06** Identify genuinely identical contiguous sequences and the current helpers that already own their responsibilities. Record the proposed extraction and callers before editing.
- [ ] **A4-07** Extract the smallest useful repeated write sequence into an ordinary helper in the existing helper area. Do not add mode registries or a generic operation engine.
- [ ] **A4-08** Convert POST first and verify its trace, ID handling, error behavior, and response contract are unchanged.
- [ ] **A4-09** Convert PATCH where the same sequence applies, keeping partial validation, existence checks, authorization, and relationship decisions visible.
- [ ] **A4-10** Convert PUT where the same sequence applies, retaining its distinct create, replacement, and omitted-relationship behavior.
- [ ] **A4-11** Review DELETE and relationship methods for actual reuse. Leave distinct sequences separate when forcing them into the helper would require extra behavioral switches.
- [ ] **A4-12** Keep full/minimal/no response selection and finish-hook handling under `handleRecordReturnAfterWrite`; remove demonstrated duplicate implementations elsewhere.
- [ ] **A4-13** Keep final response normalization after hooks that can introduce native/invalid values. Share field conversion rules across JSON:API and simplified traversals.
- [ ] **A4-14** Keep transaction completion explicit after successful response preparation and maintain the existing write-error helper as the common cleanup entrypoint.
- [ ] **A4-15** Add concise input/output and ownership documentation to extracted helpers, including whether attributes are validated or transformed and which context fields they change.
- [ ] **A4-16** Remove obsolete branches/imports only after every supported caller has migrated. Preserve supported helper imports with forwarding exports if files move.
- [ ] **A4-17** Review the resulting methods from top to bottom. If an extraction adds more flags, callbacks, or indirection than the duplication it removes, simplify or undo that extraction.
- [ ] **A4-18** Run the full conformance and relevant integration suites; compare hook traces against A4-01 through A4-05 and record any intentional bug fix separately from refactoring.

Acceptance: callers can still understand operation-specific decisions in one method, shared behavior has fewer implementations, and public hook behavior is unchanged.

## A5. Make compiled resource information authoritative

Primary files: `compile-schemas.js`, `request-contracts.js`, schema helpers, storage mapping modules, scope initialization, and the AnyAPI registry.

- [ ] **A5-01** Inventory existing representations of fields, relationships, storage mappings, getters/setters, query fields, and request contracts. Identify duplicated derivation and stale-cache risks.
- [ ] **A5-02** Extend the existing compiled schema information with a clear internal contract rather than adding a parallel schema system.
- [ ] **A5-03** Resolve field names, logical IDs, physical columns, relationship aliases, visibility, and query capabilities consistently from compiled metadata.
- [ ] **A5-04** Compile getter/setter/computed dependencies once, validate cycles/missing dependencies, and preserve established execution order and hidden-field rules.
- [ ] **A5-05** Derive request and connector schemas from the same authored validation contract. Preserve stateful validation and authorization outside those schemas.
- [ ] **A5-06** Define the boundary between public JSON values, validated values, storage values, and output values. Preserve existing custom serializer/getter/setter inputs.
- [ ] **A5-07** Reuse compiled temporal and cursor contracts where safe; avoid repeatedly compiling identical contracts per record or sort field.
- [ ] **A5-08** Define cache keys and invalidation for scope customization, query projections, mappings, tenant-specific descriptors, and relevant runtime options.
- [ ] **A5-09** Test configuration changes after registration where currently supported; ensure queries do not retain stale columns, fieldsets, sort capabilities, or validation rules.
- [ ] **A5-10** Validate impossible configurations at the earliest compatible lifecycle point, allowing legitimate forward resource references and late customization.
- [ ] **A5-11** Replace repeated metadata derivations incrementally in actual consumers. Preserve compatibility views for existing hook-accessible fields.
- [ ] **A5-12** Remove redundant caches and derivation helpers when the replacement has equivalent tested behavior and measured initialization/request costs.

Acceptance: each metadata fact has one authoritative derivation, consumers agree, and supported configuration changes cannot leave stale runtime contracts.

## A6. Complete a small, explicit storage contract

Primary files: `storage-adapter.js`, `storage-mapping.js`, `canonical-storage-mapping.js`, both Knex plugins, query helpers, and `anyapi-query-adapter.js`.

- [ ] **A6-01** Inventory storage operations the core actually needs: field/value translation, selections, filters, ordering, pagination, scoped reads, writes, and relationship changes.
- [ ] **A6-02** Define and type a minimal internal adapter interface using existing implementations as the starting point. Avoid speculative methods for unimplemented backends.
- [ ] **A6-03** Add adapter conformance tests independent of resource-method orchestration, including identifier quoting and scalar/array/null value handling.
- [ ] **A6-04** Represent the core's query requirements in small plain objects only where they remove duplicated decisions. Extend current sort and field-selection descriptors first.
- [ ] **A6-05** Keep logical field resolution, required cursor/dependency fields, stable ordering, and public pagination rules in shared core helpers.
- [ ] **A6-06** Keep physical columns, canonical slots, tenant/resource constraints, dialect-specific expressions, and driver value handling in the responsible adapter.
- [ ] **A6-07** Ensure serializer behavior is consistent across supported writes, filters, cursors, projections, and reads. Declare unsupported custom-serialization combinations explicitly.
- [ ] **A6-08** Consolidate shared query behavior one consumer at a time; preserve regular and AnyAPI query results, links, metadata, permissions, and errors.
- [ ] **A6-09** Add focused proxy compatibility tests for joins, callbacks, aliases, cloning, aggregates, raw expressions, binding forms, and supported Knex method signatures.
- [ ] **A6-10** Reduce internal reliance on proxy interception where explicit adapter calls suffice. Keep existing external query hooks working through the compatibility surface.
- [ ] **A6-11** Ensure tenant/resource and row-policy constraints survive joins, nested predicates, include loads, count queries, and cursor predicates.
- [ ] **A6-12** Add an internal backend capability description for temporal precision, returning behavior, schema changes, and supported relationship/serialization features.
- [ ] **A6-13** Validate required capabilities before executing unsupported operations, with actionable errors and no partial writes.
- [ ] **A6-14** Test fallback adapters and late-initialized included resources so behavior does not depend on which resource was queried first.
- [ ] **A6-15** Migrate remaining duplicated storage behavior only when shared tests establish equivalence. Keep dialect-specific behavior explicit.
- [ ] **A6-16** Verify existing raw-query/custom-hook examples on both backends and record deliberate capability differences in the guide.

Acceptance: storage plugins implement one documented internal contract, while core operation semantics have one implementation wherever they are actually shared.

## A7. Make transaction, cleanup, and failure semantics rigorous

Primary files: transaction helpers in `common.js`, relationship and bulk methods, file handling, Socket.IO, typed errors, and failure-injection tests.

- [ ] **A7-01** Specify internal transaction states and ownership without changing existing caller-facing behavior. Distinguish active work, acknowledged commit, acknowledged rollback, and uncertain outcome.
- [ ] **A7-02** Test failures during preparation, authorization, setters, main writes, relationship writes, finish/enrichment hooks, and commit.
- [ ] **A7-03** Ensure failures before successful commit roll back all owned database changes, including pivots and atomic bulk operations.
- [ ] **A7-04** Ensure a post-commit failure never attempts to undo committed data and retains evidence that commit was acknowledged.
- [ ] **A7-05** Preserve the original error when rollback, cleanup, logging, or failure hooks also fail; attach secondary failures as diagnostic context.
- [ ] **A7-06** Preserve typed errors through all relevant catches and wrappers, including non-Error throws handled at extension boundaries.
- [ ] **A7-07** Verify caller-owned transactions are never committed or rolled back by an individual resource method; document existing event behavior for that path.
- [ ] **A7-08** Test non-atomic bulk behavior explicitly, including per-item errors, successful writes, cleanup, and event delivery.
- [ ] **A7-09** Test upload success followed by validation/database/relationship failure, rollback cleanup failure, replacement, and deletion. Verify temporary files and tracked uploads are handled consistently.
- [ ] **A7-10** Test Socket.IO/deferred side effects for resource and relationship writes, commit, rollback, and side-effect failure. Do not imply exactly-once delivery from in-memory hooks.
- [ ] **A7-11** Exercise genuine concurrent transactions and failure timing on real databases. Avoid automatic retries of arbitrary setters, hooks, or external side effects.
- [ ] **A7-12** Document error/transaction guarantees and residual uncertainty when a connection fails during commit.

Acceptance: a failure's origin and transaction outcome remain understandable, and cleanup cannot erase the evidence needed to diagnose or safely handle it.

## A8. Measure and improve relationship performance

Primary files: relationship include/query helpers, `get-related.js`, relationship access validation, bulk methods, and benchmark fixtures/scripts.

- [ ] **A8-01** Add deterministic instrumentation for query counts and representative timing/memory measurements without exposing raw data or credentials.
- [ ] **A8-02** Record baselines for flat queries, sparse fields, nested includes, polymorphic includes, many-to-many endpoints, relationship authorization, and bulk writes.
- [ ] **A8-03** Define query-count budgets by operation shape, number of relationship types, and necessary database batch size. Avoid flaky wall-clock thresholds in normal tests.
- [ ] **A8-04** Replace proven per-record fetch bottlenecks with bounded batched reads where permissions, ordering, per-parent limits, and hook semantics can be preserved.
- [ ] **A8-05** Specifically review the per-ID fallback in `get-related.js`; verify batched results preserve the existing endpoint's payload and include behavior.
- [ ] **A8-06** Batch relationship validation and include work only when the same authorization and customization semantics apply to every item. Preserve a correct fallback for incompatible hooks.
- [ ] **A8-07** Bound batch sizes to database parameter limits and memory use; test large relationship collections and repeated IDs.
- [ ] **A8-08** Verify permissions/autofilters/row policies apply before limits and counts, and no cache or batch result can cross tenant/auth boundaries.
- [ ] **A8-09** Cache compiled metadata and safe request-local lookups where measurements justify it; avoid unbounded or authorization-blind caches.
- [ ] **A8-10** Examine real query plans for key scenarios, including nullable sorting. Recommend or generate indexes only through the library's existing schema/migration mechanisms.
- [ ] **A8-11** Add regression tests for query counts, complete results, hidden fields, per-parent limits, and callback counts after each optimization.
- [ ] **A8-12** Record before/after measurements and compatibility results. Retain an optimization only when its benefit is demonstrated.

Acceptance: measured bottlenecks improve without changing result semantics, authorization, or extension behavior.

## A9. Add useful internal type checking and diagnostics

Primary files: checked JSDoc definitions, internal helpers/adapters, new type-check configuration, and logging/error utilities.

- [ ] **A9-01** Introduce incremental `checkJs`/JSDoc checking with no required runtime transpilation step.
- [ ] **A9-02** Define shared types for compiled resources, field definitions, storage capabilities/adapters, resource identifiers, query descriptors, and result representations.
- [ ] **A9-03** Define stage-specific context guarantees without creating a duplicate runtime context hierarchy; annotate the existing helpers and actual mutation points.
- [ ] **A9-04** Check storage and lifecycle boundaries first, then expand to the internal modules changed by this plan.
- [ ] **A9-05** Resolve real shape mismatches and missing adapter members. Avoid blanket `any`, broad suppressions, or type assertions that conceal unknown behavior.
- [ ] **A9-06** Add compile-time negative fixtures proving invalid adapter calls and incompatible stage/result shapes are detected.
- [ ] **A9-07** Add stable diagnostic fields for operation, resource, phase, backend, and transaction state through existing logging facilities; preserve error causes.
- [ ] **A9-08** Redact sensitive attributes and bound logged payload size. Test diagnostics using hidden fields, uploaded-file metadata, and nested errors.
- [ ] **A9-09** Publish useful declaration files for supported public surfaces where they can accurately describe existing behavior; validate example consumers without narrowing the runtime API.
- [ ] **A9-10** Add the type check to verification and document the scope that remains dynamically typed.

Acceptance: checking catches meaningful interface errors, diagnostics identify the failing phase, and runtime consumers retain the existing API and packaging behavior.

## A10. Make documentation and release artifacts dependable

Primary files: `README.md`, `docs/`, `tests/README.md`, package configuration, examples, and publication smoke tests.

- [ ] **A10-01** Reconcile public documentation with implementation and the compatibility inventory. Correct stale hook, transaction, serializer, error, and option examples.
- [ ] **A10-02** Consolidate repeated reference explanations and link tutorials to one authoritative description of each contract.
- [ ] **A10-03** Replace long repetitive implementation comments with concise invariant/decision comments where appropriate; retain useful public JSDoc and examples.
- [ ] **A10-04** Execute representative documentation examples in automated tests, covering actual imports, configuration, outputs, hooks, and supported drivers/connectors.
- [ ] **A10-05** Update contributor/testing instructions to use the shared fixtures, real integration commands, type checks, and full verification gate.
- [ ] **A10-06** Document backend capabilities and limitations clearly, including temporal precision, real S3 availability, migrations, and externally owned transactions. Do not claim unsupported features were implemented by this roadmap.
- [ ] **A10-07** Define an explicit npm file allowlist for runtime code, supported declarations/imports, license, and selected documentation. Exclude tests, development notes, and agent configuration from publication.
- [ ] **A10-08** Inventory deep imports before changing publication or `exports` configuration. Preserve existing supported import paths and optional-peer loading behavior.
- [ ] **A10-09** Pack and install the actual tarball into temporary consumer projects, then exercise public imports, optional-plugin loading, a minimal API, and declaration-file usage.
- [ ] **A10-10** Test clean dependency installation under supported Node versions, inspect lockfile changes, and ensure tooling dependencies do not become mandatory runtime dependencies.
- [ ] **A10-11** Document the release procedure and wire local/CI gates to the real verification commands. Keep version changes separate from unrelated implementation work.
- [ ] **A10-12** Rebuild documentation and repeat package-content checks after documentation, declaration, and publication changes.

Acceptance: the published artifact is intentional, installation smoke tests pass, and documented contracts are exercised rather than merely described.

# Part B — Additive or opt-in API improvements

All four capabilities below are execution work, not an unimplemented wishlist. First check whether existing public mechanisms already provide the capability. Reuse them where possible. Record the smallest compatible design, implement missing behavior, and test both the enabled path and unchanged existing defaults.

The names below are descriptive, not fixed new identifiers. Choose names consistent with the existing API after inspecting its complete public surface. Any behavior that cannot be added compatibly must remain clearly identified for a versioned decision; do not silently change the default or count unresolved work as complete.

## B1. Machine-readable transaction outcomes on errors

Dependencies: A7; integrate with B2 and transport error handling.

- [ ] **B1-01** Define the public outcome states and their exact meaning: acknowledged commit, acknowledged rollback, unknown outcome, and any necessary distinction for a still-active caller-owned transaction or no transaction.
- [ ] **B1-02** Choose additive error metadata that preserves existing error class/code/details, original causes, and nontransactional errors.
- [ ] **B1-03** Populate outcomes from transaction evidence. A thrown commit operation must not be reported as definitely rolled back without confirmation.
- [ ] **B1-04** Surface post-commit hook failures with an acknowledged-commit outcome while preserving the existing rejection behavior.
- [ ] **B1-05** Carry safe outcome metadata through programmatic errors, HTTP JSON:API errors, bulk results, and applicable Socket.IO acknowledgments without changing existing status mappings unnecessarily.
- [ ] **B1-06** Test commit failure, rollback failure, secondary cleanup errors, borrowed transactions, non-extensible errors, and successful commit followed by hook failure.
- [ ] **B1-07** Document examples explaining when application retries could duplicate a committed write; avoid presenting the outcome as a general automatic-retry guarantee.

Acceptance: applications can distinguish materially different write outcomes using stable metadata while their existing error handling continues to work.

## B2. A managed transaction helper

Dependencies: A4, A7, B1.

- [ ] **B2-01** Inspect existing API/Knex transaction facilities and select the smallest supported helper surface; continue accepting the existing `transaction` parameter on resource methods.
- [ ] **B2-02** Specify callback arguments/return values, transaction ownership, rollback propagation, and how operations enlist their after-commit/rollback work.
- [ ] **B2-03** Implement transaction creation, awaited callback execution, commit, rollback, and result propagation with explicit ownership and no implicit process-global transaction state.
- [ ] **B2-04** Ensure resource and relationship operations inside the helper participate in the same transaction and do not finalize it individually.
- [ ] **B2-05** Queue transaction-dependent events/cleanup until the actual outer outcome; run hooks the documented number of times and in a deterministic order.
- [ ] **B2-06** Define nesting behavior explicitly. Support an established safe nesting model or reject unsupported nesting clearly; do not silently commit an outer transaction or imply savepoint support.
- [ ] **B2-07** Preserve legacy behavior for caller-supplied raw Knex transactions used outside the helper.
- [ ] **B2-08** Test mixed resource/relationship/bulk operations, callback rejection, intermediate failure, commit/rollback failure, and after-commit failure on both backends and real databases.
- [ ] **B2-09** Test upload cleanup and Socket.IO events under helper-owned commit and rollback, including multiple operations affecting the same resource.
- [ ] **B2-10** Add public import/type coverage and runnable usage examples with one successful multi-operation transaction and one rollback.

Acceptance: callers can group existing operations and receive dependable transaction and hook behavior through one optional helper.

## B3. Optional optimistic concurrency

Dependencies: A3, A5–A7, B1; verify conditional-request semantics against the HTTP specification during implementation.

- [ ] **B3-01** Select an opt-in resource configuration and programmatic expected-version argument that do not conflict with existing fields, IDs, query params, or options.
- [ ] **B3-02** Specify version initialization, representation, increment rules, and which resource/relationship changes invalidate a version. Define behavior for PUT-create, deletion, bulk operations, and simplified responses.
- [ ] **B3-03** Provide explicit schema/migration guidance for the stored version. Do not alter existing application tables silently or expose an internal version field unexpectedly.
- [ ] **B3-04** Implement the expected-version predicate and update/increment atomically in the database, including tenant and authorization constraints. Avoid a separate read-check-write race.
- [ ] **B3-05** Map failed conditions to a stable typed error, distinguishing inaccessible/missing resources from version conflicts without leaking hidden rows.
- [ ] **B3-06** Add optional HTTP ETag/If-Match support using correct strong-comparison semantics; account for response variants and any representation changes involving includes/computed fields.
- [ ] **B3-07** Define malformed, absent, multiple, wildcard, and weak validator handling explicitly. Keep requests without concurrency configuration/conditions compatible with current behavior.
- [ ] **B3-08** Ensure conditional failures do not run successful-write hooks, change relationships, leave uploads, or emit committed-change notifications.
- [ ] **B3-09** Test two genuine concurrent clients using the same version: one conditional update succeeds and the stale operation cannot overwrite it. Run on real databases and both storage modes.
- [ ] **B3-10** Test version behavior for transactions, supported bulk/relationship writes, rollback, PUT-create, DELETE, and both HTTP connectors. Reject unsupported combinations explicitly before partial work.
- [ ] **B3-11** Add public types, examples, CORS exposure/allow-header guidance, and compatibility tests showing unchanged unconditional operations.

Acceptance: enabled callers can prevent lost updates through an atomic condition, while existing unconditional calls and payloads retain their behavior.

## B4. Opt-in strict error handling

Dependencies: A4, A7, B1.

- [ ] **B4-01** Inventory remaining deliberately nonfatal getter, computed-field, and include failures. Distinguish them from invalid input, denied access, expected missing data, and best-effort cleanup failures.
- [ ] **B4-02** Select one clearly named opt-in policy with documented global/resource precedence. Preserve existing default behavior and unconditional propagation of typed API errors.
- [ ] **B4-03** Implement consistent strict behavior at the shared error boundaries, retaining original causes and useful field/resource/phase context.
- [ ] **B4-04** Ensure strict read failures cannot be mistaken for successful partial results and strict write-response failures occur before owned transaction commit.
- [ ] **B4-05** Keep post-commit and cleanup failures governed by their own transaction semantics; strict mode must not imply that a committed write can be rolled back.
- [ ] **B4-06** Test primary and included getters/computed fields, all include kinds, nested/simplified output, generic throws, and typed errors in both strict and legacy-default modes.
- [ ] **B4-07** Test HTTP/programmatic parity, option precedence, error outcomes, and unchanged results when the option is omitted.
- [ ] **B4-08** Document enablement and migration examples, including the possibility that existing partial-result responses now become errors when explicitly enabled.

Acceptance: consumers can deliberately choose strict failure behavior without changing established defaults for existing users.

# Part C — Final review and completion

## C1. Review changes in three distinct passes

- [ ] **C1-01** Review each milestone's final implementation against the relevant invariants and acceptance conditions; inspect production code as well as tests.
- [ ] **C1-02** Review the whole final patch for public compatibility: signatures, payloads, imports, default options, hook/context behavior, transaction semantics, supported backends, and additive API opt-ins.
- [ ] **C1-03** Perform an adversarial pass over interactions: malformed values, nulls, sparse fields, custom IDs, serializers, projected sorts, empty/cyclic relationships, auth boundaries, hook mutations, failures, and concurrent operations.
- [ ] **C1-04** Check that new generated links, cursors, schemas, exports, declaration files, and documentation examples are accepted by their actual consumers.
- [ ] **C1-05** Check for duplicate normalization/validation, new global state, stale caches, broad catch-and-continue behavior, speculative adapters, and helpers with excessive flags.
- [ ] **C1-06** Confirm deleted/moved code has no remaining callers and supported deep imports have compatible replacements.
- [ ] **C1-07** Add regression tests for confirmed final-review findings and fix them before repeating affected checks.

## C2. Verify and report

- [ ] **C2-01** Run the final complete verification gate with both storage modes, supported real database/connector combinations, lint, types, documentation, examples, and package installation checks.
- [ ] **C2-02** Record actual tests/pass/fail/skip counts per job, runtime/driver versions, commands, and execution conditions. Explain every material coverage limitation.
- [ ] **C2-03** Compare final query budgets, performance measurements, initialization costs, and package contents against A0 baselines.
- [ ] **C2-04** Run `git diff --check` and inspect the final status/diff for accidental generated artifacts or unrelated changes.
- [ ] **C2-05** Reconcile every open checklist item and decision. Unexecuted required work must stay open and the goal must remain active.
- [ ] **C2-06** Produce a self-contained report covering internal changes, additive API changes separately, compatibility evidence, discovered/fixed defects, performance results, remaining limitations, and exact validation results.
- [ ] **C2-07** Mark the execution goal complete only when the required implementation, verification, documentation, and final report are complete.

## Execution log

Append concise entries as work proceeds. Link to durable evidence in the repository where appropriate; temporary log paths alone are not sufficient documentation for another maintainer.

| Date | Item IDs | Change or decision | Validation/evidence | Remaining work |
| --- | --- | --- | --- | --- |
| 2026-09-08 | Planning | Created this plan against `51302ce`; implementation checkboxes intentionally start open | Reviewed current package scripts, lifecycle helpers, earlier trackers, tests, and public surfaces | Execute A0, then the verification/conformance foundation |
| 2026-09-08 | A0-01–A0-08 | Recorded the checkout, compatibility surface, lifecycle/backend inventory, prior audit reconciliation, and query/package baselines | [Durable baseline and reproduction commands](docs/development/library-improvement-baseline.md): 485 regular and 482 AnyAPI passes, one skipped test in each run; lint/docs passed; query and package measurements recorded | Continue A1 and A2; later milestones remain open |
| 2026-09-08 | A1-02, A1-05, A1-07; A2-08 partial | Allocated curl ports, expanded the standard gate/lint coverage, and fixed include traversal and hasOne regressions with shared backend tests | [Implementation and full gate evidence](docs/development/verification-progress.md): 493 regular and 490 AnyAPI passes, one skipped test each; lint/docs passed | Remaining A1 cleanup/runtime/CI work and full A2 conformance; required later checks join the gate as they land |
| 2026-09-08 | A1-10 | Verified failure propagation with a temporary deliberately failing test, then removed it | [Gate sentinel evidence](docs/development/verification-progress.md): actual verify command exited 1 and did not start later stages; missing capability coverage remains documented | Extend the gate as further checks land |
| 2026-09-08 | A1-03, A1-04 | Removed destructive AnyAPI fixture resets, scoped cleanup metadata to each database and explicit tenant, reported missing fixture metadata, and completed server/process/timer/temp-directory cleanup | [Isolation and cleanup evidence](docs/development/verification-progress.md): full suites 497 regular/494 AnyAPI passes, one skip each; focused isolation and Socket.IO runs pass in both modes; lint/docs pass; live SIGINT/SIGTERM shutdown and injected cleanup failures verified | Node/runtime documentation and CI, shared conformance and later milestones remain open |
| 2026-09-08 | A1-01, A1-09 | Defined the maintained Node 22/24 development matrix without changing consumer engine restrictions, pinned `.nvmrc`, and documented clean-checkout verification and required public tools | [Runtime evidence](docs/development/verification-progress.md) and [reproduction guide](docs/development/verification.md): isolated Node 24.6.0 `npm ci`, 497 regular/494 AnyAPI passes, one skip each, lint success; Node 22 baseline and documentation build also verified | Complete A1-06/A1-08 as conformance, real integration, types and package checks land |
| 2026-09-09 | A2-01, A2-02, A2-06, A2-08, A2-12–A2-15; A1-06 partial | Added explicit backend fixtures, field-boundary checks, generated relationships/pagination and independent operation sequences; reproduced and fixed AnyAPI numeric POST IDs using the existing normalizer | [Conformance contracts, replay and coverage map](docs/development/conformance.md), [full verification](docs/development/verification-progress.md): 513 regular-command/510 AnyAPI-command passes, one skip each, lint/docs pass; 200 generated cases per dedicated backend run; fixed and replayed regression fail before/pass after | Remaining A2 method/default/ID/transform/query/policy/atomic/capability coverage; real drivers/connectors, CI and later milestones remain open |

## Design decision log

For each material decision, record the problem, existing mechanisms considered, smallest chosen solution, compatibility impact, and tests proving it. In particular, record the A4 helper boundary, schema invalidation strategy, adapter capability contract, and B1–B4 public surfaces here before implementing them.

No new public identifiers or breaking defaults are selected by this planning document.

- Include correction: reuse existing transformers; distinguish resource deduplication from traversal. Both backends must visit remaining child paths and preserve singular hasOne linkage. See [regressions and implementation evidence](docs/development/verification-progress.md). The larger lifecycle/schema/storage refactors remain separate.
- Conformance ID domains: preserve regular integer-ID ordering and AnyAPI's existing text logical-ID ordering, including opaque IDs. Use explicit domain expectations and fixed digit-boundary cases instead of casting opaque IDs to numbers. Deterministic client IDs make generated cases independent of database sequences. Normalize AnyAPI explicit POST IDs with its existing helper before binding to the text column; see the [confirmed regression and replay](docs/development/conformance.md).

## Reference map

- Public surface: `index.js`, `plugins/core/rest-api-plugin.js`, resource and relationship methods.
- Existing shared lifecycle: `plugins/core/rest-api-plugin-methods/common.js`.
- Existing schema/validation: `compile-schemas.js`, `request-contracts.js`, `schema-helpers.js`, `scope-validations.js` under `plugins/core/lib/querying-writing/`.
- Existing representations: `database-value-normalizers.js`, `simplified-helpers.js`, and JSON:API transformer modules.
- Storage: `plugins/core/lib/storage/`, both Knex plugins, `plugins/core/lib/anyapi/`.
- Includes/query behavior: `plugins/core/lib/querying/`, `get-related.js`, `apply-query-filters.js`.
- Side effects: `file-handling-plugin.js`, `socketio-plugin.js`, bulk operations, and transaction hooks.
- Testing/release: `tests/`, `scripts/`, `package.json`, `eslint.config.js`, `docs/`.
- Earlier completed work: `fixing_plan.md`, `SINGLE_VALIDATION_CONTRACT_TODO.txt`, and commit `24ea75e`; verify stale tracker statements against code.
- Generated scenario testing: [fast-check model-based testing](https://fast-check.dev/docs/advanced/model-based-testing/) and [reproducible generated values](https://fast-check.dev/docs/introduction/what-is-property-based-testing/).
- Incremental JavaScript checking: [TypeScript checkJs](https://www.typescriptlang.org/tsconfig/checkJs.html).
- HTTP conditional requests: [RFC 9110, If-Match](https://www.rfc-editor.org/rfc/rfc9110.html#name-if-match).

## Goal completion definition

All required Part A, Part B, and Part C items have implemented or demonstrably equivalent outcomes with recorded evidence; defaults and established API behavior remain compatible; all required verification jobs pass; the maintainer has received the final report. Creating this file or enabling the goal alone does not complete execution.
