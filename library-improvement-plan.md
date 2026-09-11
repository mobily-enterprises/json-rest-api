# Library improvement execution plan

Created: 2026-09-08. Revision 2: 2026-09-09, following the maintainer's approval of coordinated breaking changes across json-rest-api, jskit-ai, vibe64, and the seeds selected by vibe64; other app migrations are explicitly deferred to the maintainer.

Starting reference: `51302ce` (`1.0.29`), following the temporal, fieldset, error-propagation, and pagination fixes in `24ea75e`. Confirm the actual checkout before implementation; other work may have advanced it.

**Library work paused at the requested library-only Part B checkpoint; consumer work remains on hold.**
The separately requested cleanup has completed four readability passes and a
structured maintainability review. The maintainer also authorized removal of
implicit pivot-field search. That source passed full Node 24 verification. The
subsequent canonical/include module split has its own focused evidence; see the
[verification ledger](docs/development/verification-progress.md). Checklist counts
are unchanged; consumer work and commit/push remain pending.
Work is confined to this repository for now: do not modify jskit-ai, vibe64,
or their seeds, or run consumer verification that changes those checkouts.
Consumer-dependent checklist items remain open. The unfinished 13-file
jskit-ai source migration is preserved in
[the local migration archive](docs/development/pending-jskit-ai/README.md),
with its patch, base revision, file checksums and reapplication instructions.
When consumer work is authorized again, reconcile and apply that work with the rest of the
coordinated migration; earlier paired test results describe the captured
migrated source, not the active jskit-ai checkout after parking.

**Library-first execution, revised 2026-09-11:** finish as much work as possible
inside json-rest-api, including the library portions of mixed checklist items.
Then pause before work that requires changes to other software. Keep the full
goal and its 214-item denominator; a mixed item stays unticked until all of its
requirements are verified. The [remaining-work split](docs/development/library-first-remaining-work.md)
separates library acceptance from paused consumer/dependency work. It does not
claim that 17 or 21 further ticks would finish the library.

**Next requested pause point, 2026-09-11:** the maintainer asks to pause after
the library-only portion of Part B, then undertake a separate broad cleanup and
commit/push. The maintainer explicitly confirmed that consumers stay paused.
The independently actionable Part B library acceptance is now recorded below.
Work is paused before the separate cleanup/commit/push and before work in other
software; consumer-dependent checkboxes remain open. Positioning and upstream
dispatcher exceptions remain explicitly deferred, not completed.
This pause point does not mark the full 214-item goal complete.

**Positioning work is paused at the maintainer's request.** The first native
run exposed duplicate keys under concurrent writes; no production positioning
fix has been made. The fixture changes and failed-run evidence are retained.
Read-only inspection of current jskit-ai found no use of PositioningPlugin or
this library's SocketIOPlugin; jskit-ai owns its separate realtime integration.

**Runtime policy, revised 2026-09-09:** require Node 24+ and run development/CI
verification on Node 24 only. Do not repeat the matrix on Node 22 or Node 26.
Keep the required databases, storage modes and connectors. Earlier multi-runtime
results are historical evidence; this policy applies to all remaining work.

**Verification cadence, revised 2026-09-11:** the maintainer requests that the
full comprehensive test lot run only very occasionally. Use focused tests for
routine work and broaden only the affected areas when shared behavior or a
failure justifies it. Reserve comprehensive runs for rare major checkpoints
with a concrete cross-cutting verification need, and final acceptance; do not
run them after each checklist closure, small fix or documentation change.
Required database and connector coverage remains part of the goal.

**Verified checklist: 138/214 complete (64.5%); 76 open.** Internal: 101/138;
API: 35/48; migration: 2/14; final review/report: 0/14. Latest evidence is in the
[verification log](docs/development/verification-progress.md#2026-09-11-library-only-part-b-pause-checkpoint).

**Latest accumulated verification:** the 2026-09-11 Node 24 `npm run verify`
checkpoint passes internal and packed public types, both query budgets,
**12,973 tests** across both full SQLite invocations and Express 4 (zero failures,
one existing skip), lint and docs. Runtime/test source was held steady throughout
this run. This includes the accumulated relationship declaration, projection,
field-selection, SQL-alias and dependency-graph fixes. Separate migration-guide
execution against the same packed artifact passes both SQLite modes and the
mapped-ID/generated-schema example. Native databases and Redis retain separately
scoped earlier evidence; this checkpoint does not rerun them or verify consumers.
See the [pause checkpoint](docs/development/verification-progress.md#2026-09-11-library-only-part-b-pause-checkpoint)
for counts and remaining exceptions.

**Current follow-up:** Executing the tutorials exposed many-to-many search
lookup, canonical membership-source and multilevel join-alias defects. The fixes
have focused SQLite/native, visibility, type and budget evidence in the
[verification log](docs/development/verification-progress.md#2026-09-11-multilevel-pivot-join-and-visibility-review).
The accumulated Node 24 gate now covers these fixes, including the later
declaration-order correction, diagnostic fixes and ID/response-option type checks.
Documentation examples retain separately scoped execution/package/docs evidence.

**Current storage-duplication work:** Query-hook context lifetime and adapter
lookup now use shared helpers in their existing modules. The context change
passed the full 11,374-test Node 24 gate; the subsequent cache extraction passes
111 selected SQLite and 222 native checks. The redundant relationship conversion
is now removed, with 2,340 SQLite and 480 native checks, types, budgets and lint
passing. A6-15 is complete. See [current evidence](docs/development/verification-progress.md#2026-09-11-storage-duplication-acceptance).

**Current native-query work:** The 655-line canonical query proxy has been
removed in favor of the existing storage adapter and native Knex builders.
Custom filters now receive explicit column/value helpers; both dependent fixture
callbacks and the migration guide are updated. Full Node 24 verification passes
11,360 tests with one existing skip, types, query budgets, lint and docs; 1,250
selected native checks pass. A6-06 is verified. A6-09/A6-10
remain open, including external-hook migration. See the
[native-query evidence](docs/development/verification-progress.md#2026-09-11-applied-native-builders-and-custom-filter-helpers).

**Current scope audit:** A6-11 is verified. The added foreign-tenant/resource
overlap selections pass 229 SQLite and 458 native tests. All database runners
cleaned up, and only the two intended test files changed from the preceding
runtime checkpoint. See the [scope evidence](docs/development/verification-progress.md#2026-09-11-tenantresource-overlap-audit).

**Current query-contract work:** A6-04 is verified. The existing mandatory
membership contract is now checked, and both sort builders share direction and
null-placement decisions. The preceding full Node 24 gate passed 11,349 tests
with one skip; the subsequent sort change passes 483 selected SQLite and 968
native checks. See the [query-object evidence](docs/development/verification-progress.md#2026-09-11-shared-sort-order-and-query-object-acceptance).

**Current typing work:** transaction lease and orchestration helpers now have
strict checked contracts. Fourteen negative-call fixtures verify lease, context,
callback and lifecycle boundaries. The full Node 24 gate passed **11,125 tests
with one existing skip**; 118 selected native checks also passed. All 270 source
hashes matched before the separate capability follow-up. This advances A6/A9
without closing their broader requirements; see the
[typing evidence](docs/development/verification-progress.md#2026-09-11-checked-transaction-orchestration).

**Current capability work:** A6-12 and A6-13 are verified. Include forwarding,
temporal precision and native SET preflight fixes pass the full Node 24 gate:
**11,307 tests with one existing skip**, types, query budgets, lint and docs.
The final native schema selection passed 414 checks; supplemental canonical slot
capacity checks passed 18 SQLite and 72 native tests. See the
[preflight evidence](docs/development/verification-progress.md#2026-09-11-native-set-preflight-and-capability-audit).

**Current connection audit:** SQL completion remains distinct from lease cleanup,
and acknowledged outcomes survive pool-release errors. A4-14 and A7-03 are
verified. The installed dispatcher can still erase an acknowledged outcome when
logging fails, so A7-04/A7-05/A7-06 remain open. See the
[cleanup evidence](docs/development/verification-progress.md#2026-09-11-sql-outcomes-survive-lease-release-failures).

**Current transaction work:** B1-03 outcome population now passes verification,
including rejection of owned savepoints before premature commit hooks/cache
publication. B2-03/B2-04/B2-06/B2-08 now verify the callback helper, shared
participation, explicit nesting and completion failures: 5,062 selected checks
pass on Node 24 across SQLite/PostgreSQL/MySQL and both storage modes. Library
transaction callers and examples are migrated, and the full Node 24 gate now
passes. A7-02's failure-phase coverage and B2-09's managed file/event tests are
verified. B2-05 now verifies completion ordering and finalizer failure isolation;
the full Node 24 gate and 1,646 selected native checks pass. A7-F10 now corrects
LocalStorage concurrent allocation and rollback data loss; the newer full gate
and 348 selected native file checks pass. A7-09 now verifies file lifetime,
replacement/deletion and failure cleanup, with 332 selected SQLite checks and
412 selected native checks passing. Committed files are application-owned;
opaque shared URLs cannot safely imply exclusive ownership. A7-10 now verifies deferred notifications and corrects A7-F11: one adapter
failure no longer abandons later queued notices. The full gate and 748 native/
Redis checks pass. Broader failure guarantees and consumer migration remain unfinished.
B1-02/B1-04/B1-05 still require
paused consumer migration, and the broader A7 failure audit remains open.

## Objective and scope

Improve correctness, maintainability, backend consistency, performance, and release confidence while retaining the library's useful light ORM character: resource declarations, `api.resources.books`, familiar CRUD operations, and relationships. Public API changes are authorized when they simplify implementation or remove ambiguity, with all affected consumers migrated in the same delivery batch.

The maintainer identifies jskit-ai as the only direct user of this library. **The downstream app is vibe64, including the public and accounts seeds selected by its Genesis catalog.** Other apps will be migrated later by the maintainer in their own repositories, using the clear API migration guide delivered here; those ports are not completion requirements. Source, generated code, dependencies, and actual workflows for jskit-ai, vibe64, and those two seeds are part of completion. API compatibility is a migration concern, not a requirement to maintain old signatures, defaults, import aliases, hooks, or transaction quirks indefinitely.

The seven internal improvement areas remain covered, with API work separately visible in Part B. Each architectural change must address a demonstrated defect, duplication, ambiguity, or measured cost. The checklist does not mandate a rewrite, a generic storage framework, or a lifecycle engine. Compare a local fix, a direct API simplification with consumer migration, and an internal refactor; implement the simplest sufficient solution. Replacing a module is allowed when that comparison demonstrates a benefit.

jskit-ai is undergoing a large expansion, estimated by the maintainer to take about eight hours from the conversation. That estimate is not a readiness signal or a ban on edits. Inspect current branches and worktrees, preserve unrelated work, and revalidate callers immediately before each migration. Isolated paired changes can proceed while expansion continues; reconcile them against the current source before integration. Do not add a temporary runtime compatibility layer to bridge the work.

Revision 1 is preserved as [historical evidence](docs/development/library-improvement-plan-v1.md). Its preservation requirements are superseded by this revision. The existing 188 item IDs remain traceable, with their open acceptance criteria revised where necessary. Part M adds 14 migration items and B0 adds 12 API simplification items: **214 items in total**. The 24 previously checked items record verified baseline/foundation work, not validation of the future API. This document revision completes no implementation item by itself.

## Checklist and evidence rules

- Every execution item has a stable identifier. Mark it `[x]` only after its acceptance condition is met.
- Record evidence in the execution log: files, relevant tests or commands, results, API decisions, and migrations in each affected repository.
- Existing functionality can satisfy an item when inspection and tests demonstrate that it already meets the requirement. Do not reimplement completed work from `fixing_plan.md` or `SINGLE_VALIDATION_CONTRACT_TODO.txt`.
- An unavailable database, skipped integration job, or unfinished API addition remains open. Explain the limitation and continue independent work.
- If a proposed mechanism proves unnecessary, record the evidence and the simpler implementation that satisfies its outcome. An inspection/design item can conclude that working code should stay; an unimplemented required capability cannot be checked off by calling it unnecessary. Keep deferred or unavailable work visibly open.
- New findings become identified checklist items with a regression case; keep unrelated feature expansion outside this plan.
- Follow each repository's applicable `AGENTS.md`. In this library use ESM, named exports for new modules, two-space indentation, shared fixtures and assertions, and JSON:API tests except where plain-record behavior is the subject. Port contract tests to the selected API instead of preserving old aliases merely to keep old tests green.
- This goal covers local implementation, verification, documentation, and a final report. Remote publishing and deployment are not completion requirements.
- A status report gives verified items/total and percentage by item count for this revision, current work, and major remaining work. Report migrations, internal improvements, and API capabilities separately. Do not compare the new percentage with revision 1 as if the scope were identical.

All references below to consumers, apps, or cross-repository migration mean jskit-ai, vibe64, and its catalog-selected public/accounts seeds unless explicitly describing the owner-managed later ports. The guide must be sufficient for those later ports without a compatibility layer.

## API and simplicity decisions

- Keep the pleasant CRUD surface and resource model. Do not rename methods or reorder arguments without a concrete improvement for callers or implementation.
- Replace `simplified` with `format: 'plain' | 'jsonapi'` and `returnFullRecord` with `returning: 'full' | 'minimal' | 'none'`. These are the selected option names and values, not additional aliases. B0 specifies their exact payloads, defaults, and precedence before code changes.
- Keep record data separate from operation controls, with one consistent write convention. Prefer the existing explicit `inputRecord` container unless consumer evidence demonstrates a simpler convention. Remove ambiguous shorthand that mixes record fields and controls after porting callers; retain convenient plain-record input without interpreting it as a JSON:API document.
- Both plain records and JSON:API documents have current consumers. Support them intentionally with one set of field conversion rules; moving HTTP serialization to a connector does not justify removing a format that jskit-ai repositories still need.
- Use one transaction ownership model across the library and jskit-ai. Integrate with or replace jskit-ai's existing transaction helper; do not create two overlapping helpers. Operations borrowing a transaction never complete it individually. Event and cleanup timing follows the actual outer outcome.
- Hooks and context are migration surfaces. Simplify their names, sequence, exposed metadata, or mutation points when that removes real complexity, and migrate all affected plugins/callers. Preserve authorization, data integrity, awaited completion, and explicit transaction ownership as correctness requirements.
- Do not ship old/new API translators, forwarding exports for removed imports, duplicate configuration parsers, legacy behavior switches, or emulated Knex proxy behavior solely for backward compatibility. A temporary source migration script is allowed; a runtime shim is not the target architecture.
- Keep domain integration code that still has a purpose, such as jskit-ai resource declarations and workspace scope resolution. Remove compensating wrappers only after the library owns their behavior and consumer tests prove the replacement.
- Keep `json-rest-schema` as the authored validation source and derive connector schemas from it. Keep authorization and database existence checks imperative.
- Use existing field normalization and representation helpers. Do not duplicate field conversion rules or normalize by serializing and reparsing JSON.
- Use a small number of plain functions and data objects. Do not introduce a pipeline registry, operation DSL, generic middleware engine, or new ORM.
- Leave method-specific validation and relationship decisions in the relevant methods. A helper needing many mode flags is a signal to keep those parts separate.
- Introduce abstractions only when actual callers and tests demonstrate their benefit. Splitting a large file is not by itself a completed improvement.
- Keep caches scoped to the correct resource, configuration version, tenant, and request. Never share authorization-dependent results across callers.
- Make intentional changes to imports, configuration, hooks, and wire contracts explicit in the migration map and release notes. Port downstream HTTP/client/assistant consumers when their payloads or links change. Preserve stored data or provide and verify a real data migration; permission to change an API is not permission to discard data.

The following option vocabulary is implemented in the worktree; coordinated dependency/seed migration and release are still in progress:

```js
await api.resources.books.patch({
  id: '42',
  inputRecord: { title: 'Updated title' },
  format: 'plain',
  returning: 'full'
})
```

Plain/full should remain the straightforward programmatic experience; HTTP JSON:API endpoints must select their representation explicitly. B0 resolves collection envelopes, relationship results, return defaults, and contextual arguments together. Machine-readable write outcomes, a single managed transaction mechanism, optional optimistic concurrency, and error-policy work remain separately tracked capabilities; none is a prerequisite merely for renaming response options.

## Milestones and dependencies

| Milestone | Work | Prerequisites | Completion evidence |
| --- | --- | --- | --- |
| M0 | Consumer and downstream-app inventory, migration contracts | Existing A0 evidence | M-01–M-06 and B0-01–B0-05 establish actual callers, baseline workflows, and the new contract |
| M1 | API simplification and paired consumer migrations | M0; focused tests for the changed behavior | B0 implementation and relevant Part M steps pass against the same local library artifact |
| M2 | Complete conformance and real integration coverage | Existing A1–A2 work; selected B0 contract | A1–A3 cover both storage modes, SQLite/PostgreSQL/MySQL, real connectors, and consumer workflows |
| M3 | Justified lifecycle/schema/storage simplification | Relevant contract and integration evidence, not every unrelated test first | A4–A6 remove demonstrated problems; affected callers migrate in each batch |
| M4 | Failure semantics, performance, internal types | Relevant M3 boundaries | A7–A9 establish explicit invariants and measured improvements |
| M5 | Separately scoped API capabilities | Each capability's actual prerequisites | B1–B4 work through migrated consumers; no mandatory legacy branch |
| M6 | Final cross-repository reconciliation, documentation, package and triple review | All preceding required outcomes | Part M, A10, and C complete against current expansion results and actual packaged dependencies |

Execute small, reviewable paired changes. Build the tests needed for the next change, then implement and migrate it; do not exhaustively preserve obsolete option combinations before adopting B0. Documentation and typing accompany the affected work. Continue independent library work while a consumer branch is moving, and reconcile source before claiming migration complete.

# Part M — Coordinated consumer and application migration

The initial [consumer inspection](docs/development/consumer-migration.md) is a starting point. **In scope: jskit-ai, vibe64, and its catalog-selected public/accounts seeds.** Other apps are owner-managed later migrations and require a usable guide, not a port in this goal. Initial installed-dependency results and subsequent worktree-tarball checks are distinguished in the evidence guide.

- [x] **M-01** Inventory jskit-ai, vibe64, and its catalog-selected seeds: repository path, branch/commit, dirty work, dependency versions, generated source, and verification commands. Include the public/accounts branches referenced by vibe64; do not expand to unrelated seeds, other worktrees, or other applications; record the maintainer's later-port responsibility.
- [ ] **M-02** Trace direct, indirect, dynamic, and generated use of resource methods, response shapes, options, hooks/context, serializers, projections, policies, transactions, and imports across those repositories.
- [ ] **M-03** Record baseline consumer workflows: CRUD, user/workspace repositories, permissions and tenant isolation, HTTP/client behavior, assistant pagination, relationships, transactions, and any newly added expansion features.
- [x] **M-04** Create a reproducible local artifact/link verification path and prove each consumer resolves the exact intended library build. Use isolated installs where needed; do not mutate another task's installed dependencies or lockfile incidentally.
- [ ] **M-05** Record each intended breaking change with old/new call examples, affected source/tests/templates/apps, data implications, and the checks proving migration. Decide default behavior once; do not leave old/new parsers in the runtime.
- [ ] **M-06** Reassess each architectural proposal against a demonstrated problem, comparing a local fix, direct API simplification, and internal refactoring. Retain working internals when change buys nothing; keep required correctness/capability work open.
- [ ] **M-07** Before every migration batch, refresh branches, diffs, and usage searches against the ongoing jskit-ai expansion. Work in isolated checkouts when needed and reconcile overlapping edits without discarding either task's work.
- [ ] **M-08** Reconcile the [parked first migration batch](docs/development/pending-jskit-ai/README.md) against current source, then finish porting jskit-ai's host, shared CRUD repositories, user/workspace repositories, dependency declarations, and tests alongside the changed library surface. Add no runtime compatibility bridge.
- [ ] **M-09** Port generated-code templates, authored examples, integration documentation, and fixtures; run the owning repository's documented generators and review their outputs. Regeneration must produce the new API directly.
- [ ] **M-10** Port vibe64 and its public/accounts seed branches, including custom hooks, repositories, HTTP/client consumers, and dependency/lockfile updates. Its migration is not proven by jskit-ai's tests alone. Document equivalent steps for the maintainer's later ports of other apps without changing those apps here.
- [ ] **M-11** Remove obsolete aliases, duplicate argument/return handling, forwarding imports, and consumer workarounds after their responsibilities are covered. Search actual consumers and generated outputs for remaining old calls.
- [ ] **M-12** After the expansion advances or finishes, repeat the consumer inventory and reconcile new call sites, changed templates, and package versions. Elapsed time alone does not establish readiness or completion.
- [ ] **M-13** Run jskit-ai, vibe64, and both seeds' required checks against the intended local artifacts, then exercise representative real workflows. Record exact source revisions, package resolution, results, and any remaining gaps.
- [ ] **M-14** Prepare a coordinated version/dependency and migration record identifying the compatible library/jskit-ai/vibe64/seed revisions and the prerequisites for later app migrations. Local paired changes must be reviewable and fully tested; remote publication/deployment remains outside scope.

Acceptance: the simpler API works through current jskit-ai and vibe64, generated code uses it directly, unrelated expansion work is preserved, and no runtime layer exists solely to keep obsolete calls working.

## Historical starting observations

These describe the original A0 starting point, not the present state. Completed fixes and current evidence are in the execution log and development guides:

- The last recorded full runs after `24ea75e` passed 485 regular-backend tests and 482 AnyAPI tests, with one skipped test in each run, using Node 22 and SQLite.
- `npm run verify` currently runs the ID-focused tests and documentation, rather than both full suites and lint.
- `tests/curl.test.js` uses fixed port 3456. Concurrent full-suite runs previously conflicted.
- Fastify parity tests currently use `tests/helpers/fake-fastify.js`.
- `eslint.config.js` excludes tests and examples.
- `common.js` already contains `setupCommonRequest`, `validateResourceAttributesBeforeWrite`, `applyFieldSetters`, `handleRecordReturnAfterWrite`, `handleWriteMethodError`, and `commitOwnedTransaction`.
- Both storage plugins implement substantial query behavior. AnyAPI also wraps Knex builders with method interception.
- A related-resource fallback calls `get` once per related ID in `get-related.js`.
- A package dry run included tests, development notes, and agent instructions. The final allowlist must include the selected public surface after consumer imports are migrated.

# Part A — Internal correctness and simplification

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
- [x] **A1-06** Add explicit commands for conformance, real-driver/connector integration, type checking, package checks, and paired consumer verification as those capabilities land. Each failure must produce a nonzero exit status. The [command inventory and failure review](docs/development/verification.md#command-failure-behavior) maps all categories to current scripts and their rejecting runners. An actual isolated consumer-command probe propagated child exit 7 and cleaned its temporary package; invalid native/tutorial selections fail before setup. Full and selected passing evidence remains separately recorded. This completes commands and failure propagation, not paused consumer acceptance; see [verification evidence](docs/development/verification-progress.md#2026-09-11-verification-commands-and-plugin-tutorial-accepted).
- [x] **A1-07** Extend lint coverage to maintained tests and scripts, resolving relevant findings without an unrelated repository-wide formatting rewrite.
- [x] **A1-08** Add CI jobs for the supported Node versions and appropriate database/connector matrix. Use isolated disposable databases and explicit service readiness checks.
- [x] **A1-09** Document one reproducible clean-checkout verification sequence and the required local services/tools. Do not require private credentials for the standard suite.
- [x] **A1-10** Verify the complete gate detects a deliberately introduced local failure, then remove that temporary change. Capture skipped capability coverage explicitly.

Acceptance: the advertised verification command exercises the full maintained contract, failures cannot be mistaken for success, and test servers do not conflict.

## A2. Build a shared behavioral conformance suite

Primary files: `tests/fixtures/api-configs.js`, `tests/helpers/`, existing contract suites, and focused new conformance suites.

- [x] **A2-01** Define a small fixture interface for backend setup, resource configuration, cleanup, seeding, inspection, and teardown. Keep resource registration in fixture modules.
- [x] **A2-02** Run identical public-behavior assertions against regular storage and AnyAPI. Parameterize the backend instead of copying test bodies.
- [x] **A2-03** Cover GET/query/POST/PUT/PATCH/DELETE and all relationship endpoints, including PUT creation and replacement semantics.
- [x] **A2-04** Cover the selected plain/JSON:API formats, programmatic and connector defaults, per-call overrides, and none/minimal/full write returns. Migrate the historical simplified/returnFullRecord matrix to B0; do not retain obsolete aliases as a conformance requirement.
- [x] **A2-05** Cover numeric and opaque IDs, custom `idProperty`, ID normalization, custom column mappings, and path/body ID consistency.
- [x] **A2-06** Cover missing, undefined, null, false, zero, empty-string, defaulted, virtual, hidden, and normally-hidden field behavior where applicable.
- [x] **A2-07** Cover date/dateTime/time, epochs, precision, offsets, SQL driver values, getters, setters, computed fields, and custom serializers with explicit expected public values.
- [x] **A2-08** Cover belongsTo, hasOne, hasMany, many-to-many, polymorphic and nested includes, empty relationships, cycles, and repeated references where supported.
- [x] **A2-09** Cover filters, sparse fields, query projections, sorting, pagination modes, caps, nullable sort values, duplicate keys, and generated-link round trips.
- [x] **A2-10** Cover authorization, autofilters, and row policies on primary records, includes, relationship linkage, counts, pagination, and bulk operations. Assert that denied rows do not leak through any representation.
- [x] **A2-11** Define independent invariants for successful writes, rejected writes, atomic bulk operations, relationship integrity, typed errors, and final response normalization.
- [x] **A2-12** Add generated cases with deterministic seeds and failure shrinking for field values, sort combinations, page sizes, and relationship shapes. Reuse the existing test runner.
- [x] **A2-13** Add generated operation sequences against a small independent state model: create, update, relate, query, and delete. The model must not call production normalization or query code to calculate expectations.
- [x] **A2-14** Assert complete pagination traversals return the expected records once each on an unchanged dataset; cover forward and backward traversal and tied/null sort values.
- [x] **A2-15** Preserve seed/replay information for generated failures and turn confirmed regressions into small permanent examples.
- [x] **A2-16** Map each supported capability to executed tests. List real backend limitations explicitly rather than weakening shared assertions to make results agree. The [capability map](docs/development/conformance.md#capability-map) reconciles all 24 root exports, installed resource/API methods, documented bulk/positioning imports and all 65 shared suites. Current Node 24 labels/Socket.IO SQL checks pass 684/684 and real Redis passes 68/68; prior full/runtime and per-batch native evidence remains explicit. Known positioning failures, unimplemented real S3, unverified combinations and paused consumer work retain their separate status. This closes the coverage-mapping item, not A4–A10, Part B/M or final review; see the [reconciliation evidence](docs/development/verification-progress.md#2026-09-10-capability-evidence-reconciliation).

Acceptance: matching backends must also satisfy independently defined behavior. Passing by sharing the same mistake is insufficient.

## A3. Test real databases and real HTTP connectors

Primary files: integration fixtures and scripts, `tests/fastify-plugin.test.js`, `tests/http-connectors-parity.test.js`, database capability helpers, and CI configuration.

- [x] **A3-01** Provide disposable PostgreSQL and MySQL integration environments, plus SQLite, with isolated database/schema names and reliable teardown.
- [x] **A3-02** Run both storage modes against each supported database combination. Mark a combination unsupported only when its limitation is explicit and documented.
- [x] **A3-03** Exercise actual driver behavior for temporal fields, high-precision input, time-only values, epochs/bigints, booleans, null ordering, and serialization comparisons.
- [x] **A3-04** Exercise custom IDs, generated IDs, insert/returning fallbacks, qualified joins, aliases, parameter binding, count queries, and pagination SQL.
- [x] **A3-05** Exercise schema creation, introspection, migration generation, static/function defaults, and storage mappings on real databases.
- [x] **A3-06** Exercise commit/rollback, concurrent connections, isolation-sensitive updates, and relationship integrity with actual transactions.
- [x] **A3-07** Instantiate real Fastify for integration tests and use its actual validation, routing, parsing, serialization, and error handling. Retain small fakes only where they serve a focused unit-test purpose.
- [x] **A3-08** Run connector conformance through actual Express and Fastify request handling, including the advertised supported major versions.
- [x] **A3-09** Compare real connector and in-process behavior for malformed bodies, query coercion, content types, errors, headers, links, response formats, and relationship routes.
- [x] **A3-10** Test real multipart detector APIs for valid uploads, limits, malformed input, cancellation, and cleanup; avoid relying solely on hand-written detector fakes.
- [x] **A3-11** Include CORS and Socket.IO contract tests in the verification matrix, particularly request rejection and events associated with writes and relationship changes.
- [x] **A3-12** Make required CI integration jobs fail when their services or tests are unavailable; document how local runs report a deliberately omitted integration environment.

Acceptance: SQLite, fake-server behavior, or SQL string assertions alone do not establish cross-driver and connector compatibility.

## A4. Refactor the operation lifecycle without introducing a framework

Primary files: `plugins/core/rest-api-plugin-methods/common.js`, resource methods, relationship methods, and lifecycle tests.

The repeated before-data hooks, setters, storage call, and after-data hooks are a candidate, not a prescribed architecture. First account for B0 and actual hook consumers. Removing an awkward public contract may be simpler than extracting machinery to preserve it. Keep operation-specific validation and relationship decisions visible.

- [ ] **A4-01** Inventory current hook order and context guarantees, including nested GETs for write responses; identify actual library/plugin/jskit-ai consumers and specify the smallest justified final contract.
- [x] **A4-02** Add trace tests for the selected POST, PUT-create, PUT-update, PATCH, and DELETE contract, covering hook names, order, counts, and awaited completion. Record deliberate old/new differences.
- [x] **A4-03** Add corresponding trace tests for relationship writes and bulk operations under the selected transaction model, including owned and borrowed transactions. Bulk POST/PATCH/DELETE and 88 relationship cases now verify exact awaited stages, nested child PATCHes, distinct contexts, shared/separate transaction identities, completion ordering and stored results. Relationship coverage includes ordinary/inverse many-to-many, hasMany, hasOne, belongsTo, polymorphic/reverse polymorphic, explicit clearing, owned commit/finish failure and managed commit/callback rollback. The complete lifecycle file passes 2,808 checks across SQLite/PostgreSQL/MySQL and both storage modes. See [composition evidence](docs/development/verification-progress.md#2026-09-10-composed-relationship-lifecycle-traces).
- [ ] **A4-04** Verify documented hook-visible IDs, input/current attributes, result records, operation names, auth context, and transaction identity. Migrate consumers of removed or changed context fields.
- [x] **A4-05** Inject failures at each retained lifecycle stage and assert which later hooks must not run, whether data changes, and which error reaches the caller. Existing resource-stage injection is complemented by 114 composed bulk cases and 244 pivot/reverse relationship cases, including nested old/new child PATCHes and each enlisted afterCommit hook. Exact reached prefixes, no later pre-commit work, rollback/commit completion order, original causes, outcomes, transaction/context identity and stored state pass 4,956 lifecycle checks across three databases and both storage modes. Broader A7 extension/logging/uncertain-completion guarantees remain separate. See [stage-injection evidence](docs/development/verification-progress.md#2026-09-10-relationship-failure-stage-traces).
- [x] **A4-06** Identify repeated sequences and the helpers already responsible for them. Compare direct API simplification with internal extraction; record the demonstrated problem, chosen boundary, affected consumers, and expected reduction in complexity before editing.
- [x] **A4-07** Remove the demonstrated repeated write orchestration with the smallest sufficient change. Use ordinary helpers where they simplify actual callers; do not build a mode registry or generic operation engine, and do not force an extraction when a simpler contract removes the duplication.
- [ ] **A4-08** Implement the chosen POST lifecycle and migrate its consumers; verify ID handling, trace, failure behavior, and selected response contract.
- [x] **A4-09** Apply the same simplification to PATCH where appropriate, keeping partial validation, existence checks, authorization, and relationship decisions explicit.
- [ ] **A4-10** Apply the simplification to PUT while testing its distinct create/replacement and omitted-relationship semantics; migrate any deliberately changed behavior.
- [x] **A4-11** Review DELETE and relationship methods for actual reuse. Keep distinct sequences separate when sharing would require extra switches; migrate hooks only where simplifying them has a demonstrated benefit.
- [ ] **A4-12** Keep selected response preparation and finish-hook behavior in one existing helper where practical. Remove old boolean/return aliases and duplicate response branches after B0 callers migrate.
- [ ] **A4-13** Keep final response normalization after every retained hook that can introduce native/invalid values. Share conversion rules across JSON:API and plain traversals, including migrated jskit-ai temporal behavior.
- [x] **A4-14** Keep transaction completion explicit after successful response preparation, with one cleanup entrypoint implementing the selected ownership contract. The [completion-order audit](docs/development/verification-progress.md#explicit-response-preparation-and-completion-audit-a4-14) records shared response preparation, central cleanup and passing full/native verification.
- [x] **A4-15** Add concise input/output and ownership documentation to extracted helpers, including whether attributes are validated or transformed and which context fields they change.
- [ ] **A4-16** Remove obsolete branches, imports, and hook/context views after all actual callers and examples migrate. Remove old deep-import paths directly; do not add forwarding exports solely for compatibility.
- [x] **A4-17** Review the resulting methods from top to bottom. If an extraction adds more flags, callbacks, or indirection than the duplication it removes, simplify or undo that extraction.
- [ ] **A4-18** Run conformance, relevant real integrations, and affected jskit-ai/app checks. Compare traces with the selected A4 contract and record intended API changes separately from discovered defects.

Acceptance: operation-specific behavior remains readable, demonstrated duplication/ambiguity is removed, and all consumers use the selected hook/context contract directly.

## A5. Make compiled resource information authoritative

Primary files: `compile-schemas.js`, `request-contracts.js`, schema helpers, storage mapping modules, scope initialization, and the AnyAPI registry.

- [x] **A5-01** Inventory existing representations of fields, relationships, storage mappings, getters/setters, query fields, and request contracts. Identify duplicated derivation and stale-cache risks. See the [resource metadata inventory](docs/development/compiled-resources.md).
- [ ] **A5-02** Make existing compiled metadata authoritative for the facts actual consumers need. Extend or simplify it to remove demonstrated duplicate derivation; do not create a parallel schema system.
- [ ] **A5-03** Resolve field names, logical IDs, physical columns, relationship aliases, visibility, and query capabilities consistently from compiled metadata.
- [x] **A5-04** Compile getter/setter/computed dependencies once where that removes repeated work, validate cycles/missing dependencies, and test the selected execution order and visibility rules.
- [x] **A5-05** Derive request and connector schemas from the same authored validation contract. Preserve stateful validation and authorization outside those schemas. Shared contract/export checks and real HTTP tests cover enriched declarations and post-startup relationship additions; see the [metadata/contract evidence](docs/development/verification-progress.md#2026-09-09-schema-enrichment-canonical-metadata-and-connector-contracts).
- [ ] **A5-06** Define the boundary between public JSON values, validated values, storage values, and output values. Simplify serializer/getter/setter inputs when warranted and migrate the jskit-ai declarations and transformations together.
- [x] **A5-07** Reuse compiled temporal and cursor contracts where safe; avoid repeatedly compiling identical contracts per record or sort field.
- [x] **A5-08** Define cache keys and invalidation for scope customization, query projections, mappings, tenant-specific descriptors, and relevant runtime options.
- [x] **A5-09** Specify when resource configuration becomes effective and test changes permitted by that contract. Prefer explicit initialization/finalization over elaborate invalidation machinery when actual callers can migrate safely.
- [ ] **A5-10** Validate impossible configurations at the earliest lifecycle point consistent with the selected contract; support needed forward references and migrate actual late-customization callers.
- [ ] **A5-11** Replace repeated metadata derivations in actual consumers. Migrate hook-accessible schema consumers, including jskit-ai, and remove obsolete metadata views rather than retaining compatibility copies.
- [ ] **A5-12** Remove redundant caches and derivation helpers when the replacement has equivalent tested behavior and measured initialization/request costs.

Acceptance: each metadata fact has one authoritative derivation, consumers agree, and supported configuration changes cannot leave stale runtime contracts.

## A6. Complete a small, explicit storage contract

Primary files: `storage-adapter.js`, `storage-mapping.js`, `canonical-storage-mapping.js`, both Knex plugins and query helpers. The former canonical query proxy has been removed.

- [x] **A6-01** Inventory storage operations the core actually needs: field/value translation, selections, filters, ordering, pagination, scoped reads, writes, and relationship changes. See the [storage-operation inventory](docs/development/storage-boundaries.md).
- [x] **A6-02** Type and document the existing storage boundaries needed by real callers. Introduce a shared interface only where it removes demonstrated duplication or defects; do not add a generic adapter layer just to complete this item. The [boundary acceptance map](docs/development/storage-boundaries.md#storage-boundary-declaration-acceptance) reconciles adapter/mapping/query, data, relationship/count/link, transaction and capability contracts. All 10 ordinary and 11 canonical data/transaction assignments have declarations; eight new negative cases and a direct deferred-query regression supplement existing checks. Types, packed declarations and 720 selected native tests pass. This completes caller-boundary typing/documentation; checking all plugin implementation bodies and consumer migration remain under A9 and the separate A6/M items. See [acceptance evidence](docs/development/verification-progress.md#2026-09-11-storage-boundary-declarations-accepted).
- [x] **A6-03** Test the selected storage boundaries independently of resource orchestration, including identifier quoting and scalar/array/null value handling. Direct adapter and table-ID checks pass on Node 24 and all three databases; see the [storage-boundary evidence](docs/development/verification-progress.md#2026-09-10-direct-storage-boundaries-and-declared-primary-ids).
- [x] **A6-04** Represent the core's query requirements in small plain objects only where they remove duplicated decisions. Extend current sort and field-selection descriptors first. The [query-object acceptance audit](docs/development/storage-boundaries.md#query-requirement-objects-a6-04-acceptance-audit) maps the existing selection/sort/membership/pagination objects to their owners. Shared sort ordering removes repeated direction/null decisions; 483 applied SQLite and 968 native checks pass, with types, query budgets, lint and documented source reconciliation.
- [x] **A6-05** Keep logical field resolution, required cursor/dependency fields, stable ordering, and public pagination rules in shared core helpers. Existing selection/sort/pagination helpers now own these decisions in both storage modes; see [shared pagination evidence](docs/development/verification-progress.md#2026-09-10-shared-pagination-setup). Remaining field-capability/visibility validation stays under A5-03/A5-10.
- [x] **A6-06** Keep physical columns, canonical slots, tenant/resource constraints, dialect-specific expressions, and driver value handling in the responsible adapter. The [physical-storage ownership audit](docs/development/storage-boundaries.md#physical-storage-ownership-a6-06-acceptance-audit) maps each concern to existing backend/mapping/SQL helpers. Aliased canonical scoping now uses the storage adapter, replacing the query proxy. Full Node 24 verification passes 11,360 tests with one existing skip; 1,250 selected native tests and source reconciliation pass.
- [x] **A6-07** Ensure serializer behavior is consistent across supported writes, filters, cursors, projections, and reads. Declare unsupported custom-serialization combinations explicitly. Scalar and structured-value boundaries, projection/getter behavior, identity/async rejections, real HTTP and all three databases pass; see the [serializer verification](docs/development/verification-progress.md#2026-09-10-structured-query-capabilities-and-postgresql-json-selections).
- [x] **A6-08** Consolidate shared query decisions one consumer at a time; test regular/AnyAPI results, links, metadata, permissions, and typed errors against the selected contract. The [shared-query acceptance review](docs/development/storage-boundaries.md#shared-query-decisions-a6-08-acceptance-review) maps both plugins to their shared selection, membership, sort and pagination helpers and verifies all five result/behavior categories against the current 11,360-pass full gate and 1,250 native checks.
- [ ] **A6-09** Inventory actual Knex/proxy usage and test retained joins, callbacks, aliases, cloning, aggregates, raw expressions, and binding forms. Do not emulate an unused legacy method surface; document intentional removals and port callers.
- [ ] **A6-10** Replace proxy interception with direct storage calls where this simplifies implementation. Migrate actual external query hooks to the selected interface and remove obsolete proxy compatibility behavior.
- [x] **A6-11** Ensure tenant/resource and row-policy constraints survive joins, nested predicates, include loads, count queries, and cursor predicates. The [scope-preservation audit](docs/development/storage-boundaries.md#scope-and-policy-preservation-a6-11-acceptance-audit) reconciles owners and coverage, including foreign-tenant/resource identity overlap, hook replacements, nested/polymorphic joins, counts and cursor/include visibility. Added selections pass 229 SQLite and 458 native tests; documented hook constraints and raw-query migration limits remain explicit.
- [x] **A6-12** Add an internal backend capability description for temporal precision, returning behavior, schema changes, and supported relationship/serialization features. The existing capability module supplies these descriptions to both plugins and shared helpers. The [acceptance review](docs/development/storage-boundaries.md#capability-description-acceptance-review-a6-12) records scope, unknown-driver limits, 11,229 full-gate passes and 730 selected native passes. Capability enforcement remains under A6-13.
- [x] **A6-13** Validate required capabilities before executing unsupported operations, with actionable errors and no partial writes. Include, temporal/schema, SET, insert, serializer, relationship and canonical-capacity checks are reconciled in the [acceptance review](docs/development/storage-boundaries.md#capability-preflight-acceptance-review-a6-13); the full Node 24 gate passes 11,307 tests with one existing skip, with supplemental native and capacity evidence.
- [x] **A6-14** Test fallback adapters and late-initialized included resources so behavior does not depend on which resource was queried first. Full/sparse include, mapped policy, cold/warm target and canonical field-addition checks pass on Node 24 and all three databases; see the [include adapter evidence](docs/development/verification-progress.md#2026-09-09-include-field-selection-and-adapter-initialization).
- [x] **A6-15** Migrate remaining duplicated storage behavior only when shared tests establish equivalence. Keep dialect-specific behavior explicit. The [duplication acceptance review](docs/development/storage-boundaries.md#remaining-storage-duplication-a6-15-acceptance) maps shared query/context/cache owners, removes the obsolete second relationship conversion, and retains physical write differences explicitly. The final write selection passes 2,340 SQLite and 480 native checks; types, budgets and lint pass.
- [ ] **A6-16** Migrate and execute raw-query/custom-hook examples and actual consumer queries on their supported backends; record deliberate capability differences.

Acceptance: actual storage boundaries are explicit and tested, duplicated decisions have a single owner where useful, and no general adapter/proxy framework exists merely to preserve historical calls.

## A7. Make transaction, cleanup, and failure semantics rigorous

Primary files: transaction helpers in `common.js`, relationship and bulk methods, file handling, Socket.IO, typed errors, and failure-injection tests.

- [ ] **A7-01** Specify transaction states and ownership across the library, jskit-ai, and apps. Distinguish active work, acknowledged commit, acknowledged rollback, and uncertain outcome; migrate ambiguous old behavior.
- [x] **A7-02** Test failures during preparation, authorization, setters, main writes, relationship writes, finish/enrichment hooks, and commit. The [phase-to-test map](docs/development/verification-progress.md#2026-09-10-managed-caller-migration-and-full-gate) reconciles lifecycle injection, field callback failures, real write contention, partial relationship changes and driver completion failures. The full Node 24 gate passes on the managed contract; the preceding 5,062-case ownership matrix covers the unchanged runtime on all three databases. This completes phase coverage, not the remaining A7 cleanup, extension or consumer guarantees.
- [x] **A7-03** Ensure failures before successful commit roll back all owned database changes, including pivots and atomic bulk operations. The [owned rollback audit](docs/development/verification-progress.md#owned-rollback-requirement-audit-a7-03) covers rows, linkage, bulk, registry and schema owners. Failed completion remains explicitly unknown; this does not claim rollback acknowledgement when the driver cannot establish it.
- [ ] **A7-04** Ensure a post-commit failure never attempts to undo committed data and retains evidence that commit was acknowledged. **A7-F07 corrected:** owned savepoints now reject before release instead of running commit hooks or publishing registry metadata while the parent remains pending. Confirmed savepoint rollback retains unrelated parent work and permits file cleanup. Eighteen new cases and 2,494 selected native passes verify the boundary; Core post-commit rollback guards now also have mutation-checked method-call assertions. However, a hooked-api logging failure after commit can return an error without its acknowledged outcome; the retained dispatcher patch is not installed, so this whole-API guarantee remains open.
- [ ] **A7-05** Preserve the original error when rollback, cleanup, logging, or failure hooks also fail; attach secondary failures as diagnostic context. **A7-F02 corrected:** child cleanup diagnostics now survive on the caller's batch context with a zero-based `bulkIndex`; successful warnings and rejected calls retain their original secondary errors. **A7-F05 corrected:** rollback rejections exposed only by Knex `executionPromise` now survive as diagnostics; all owned commit sites also await that promise before hooks or cache publication. Fifty-six regressions, full Node 24 gates, 2,278 native cases and 92 Redis cases verify that correction. **A7-F06 corrected:** PostgreSQL COMMIT reporting ROLLBACK now rejects and allows confirmed rollback cleanup without a second control statement. Eighteen PostgreSQL regressions and 2,314 native passes cover resource, bulk, registry and file behavior; all full gate stages pass, with an unexplained Socket.IO connection failure in the first invocation retained in the evidence log. Remaining extension boundaries and managed completion keep this item open. **A7-F09 corrected:** finalizer failures no longer skip later diagnostic collection or replace an earlier after-commit failure. Four regressions fail before the fix; full Node 24 and 1,646 selected native checks pass. The broader audit remains open.
- [ ] **A7-06** Preserve typed errors through all relevant catches and wrappers, including non-Error throws handled at extension boundaries. The installed hooked-api dispatcher still loses null/undefined failures. A [tested upstream patch and integration regression](docs/development/pending-hooked-api/README.md) are retained: six regressions fail on 1.0.24; the extended isolated patch passes 295 upstream and 24 library integration checks, including secondary diagnostic logging failures. Dependency release/consumption, plugin installation and remaining logging boundaries stay open.
- [ ] **A7-07** Verify operations never commit or roll back a borrowed transaction. Migrate callers to the single selected ownership/event contract and document any intentionally unsupported unmanaged side effects. **A7-F01 corrected:** bulk POST/PATCH/DELETE now use the supplied transaction without completing it; non-atomic participation rejects before children or SQL. Twenty-four new cases fail on the old source and pass in both modes; full Node 24 checks and 1,024 selected native cases pass. The managed ownership/event contract and consumer migration remain open. See [bulk ownership evidence](docs/development/verification-progress.md#2026-09-10-borrowed-bulk-transactions). **A7-F08 corrected:** private ownership now prevents a participant from entering owner rollback and deadlocking, and prevents diagnostic flags from suppressing implicit completion. Four ownership regressions and 5,062 selected checks pass across both modes and SQLite/PostgreSQL/MySQL; remaining caller migration and integration keep this item open. See [managed ownership evidence](docs/development/verification-progress.md#2026-09-10-managed-ownership-registry-and-concurrency).
- [x] **A7-08** Test non-atomic bulk behavior explicitly, including per-item errors, successful writes, cleanup, and event delivery. Indexed cleanup/tracking, actual files, committed rows/linkage and polling/WebSocket delivery are verified, including middle-entry failures and rejected cleanup hooks. Full Node 24 gates, 1,680 selected native cases and 92 real Redis cases pass. Post-commit call errors are distinguished from rolled-back writes; outer managed completion and outcomes remain separate. See [non-atomic bulk evidence](docs/development/verification-progress.md#2026-09-10-non-atomic-bulk-cleanup-and-delivery).
- [x] **A7-09** Test upload success followed by validation/database/relationship failure, rollback cleanup failure, replacement, and deletion. Verify temporary files and tracked uploads are handled consistently. A7-F03/F04/F10 corrections retain cleanup diagnostics, normalize stored handles and reserve LocalStorage uploads exclusively. Verified replacement/deletion preserves shared committed objects; rollback removes only new uploads and restores rows/relationships. Committed objects are application-owned because file URLs do not imply exclusive references. Real SQL and child-write failures, temporary/rollback cleanup failures, and both response/storage modes pass. See [file lifetime evidence and requirement mapping](docs/development/verification-progress.md#2026-09-10-file-lifetime-and-failure-coverage).
- [x] **A7-10** Test Socket.IO/deferred side effects for resource and relationship writes, commit, rollback, and side-effect failure. Do not imply exactly-once delivery from in-memory hooks. **A7-F11:** the deferred queue now attempts later notices after an adapter failure and retains indexed diagnostics plus the first error. The regression fails before the fix, and 748 selected native/Redis checks pass. The full Node 24 gate passes 10,163 tests with one existing skip; see [broadcast failure evidence](docs/development/verification-progress.md#2026-09-10-deferred-broadcast-failure-isolation).
- [x] **A7-11** Exercise genuine concurrent transactions and failure timing on real databases. Avoid automatic retries of arbitrary setters, hooks, or external side effects. The concurrency suite verifies independent connections, isolation, lock contention, native deadlocks, stale snapshots, relationship deletion/replacement races, atomic bulk visibility and generated IDs. A new real-conflict case proves setters and hook side effects run once and remain unreplayed through rollback/commit. All 208 selected checks pass on Node 24 across SQLite/PostgreSQL/MySQL and both storage modes. See [concurrency evidence](docs/development/verification-progress.md#2026-09-10-concurrent-conflicts-without-replay).
- [x] **A7-12** Document error/transaction guarantees and residual uncertainty when a connection fails during commit. The outcome contract maps acknowledged commit/rollback, failed completion and lost acknowledgement to the five states; documents primary/secondary errors, skipped outcome hooks, upload reconciliation, snapshot semantics and retry limits; and distinguishes injected driver-boundary coverage from untested physical-network/failover sequences. API and migration guides link the contract and reflect verified managed integration. See [documentation evidence](docs/development/verification-progress.md#2026-09-10-commit-uncertainty-documentation).

Acceptance: a failure's origin and transaction outcome remain understandable, and cleanup cannot erase the evidence needed to diagnose or safely handle it.

## A8. Measure and improve relationship performance

Primary files: relationship include/query helpers, `get-related.js`, relationship access validation, bulk methods, and benchmark fixtures/scripts.

- [x] **A8-01** Add deterministic instrumentation for query counts and representative timing/memory measurements without exposing raw data or credentials. The fixture runner measures read/write shapes, statement/configuration counts, elapsed time and heap deltas in both storage modes; repeated statement/result counts match. A8-02 expands its original six scenarios. See [instrumentation and limits](docs/development/query-measurements.md).
- [x] **A8-02** Record baselines for flat queries, sparse fields, nested includes, polymorphic includes, many-to-many endpoints, relationship authorization, and bulk writes. The existing runner verifies the original 42 shapes/scales plus two batch-boundary cases in both modes on SQLite/PostgreSQL/MySQL, with matching counters across databases; [the baseline results](docs/development/query-measurements.md#workload-baselines) distinguish target-type costs, per-target write work and atomic/non-atomic bulk operations.
- [x] **A8-03** Define query-count budgets by operation shape, number of relationship types, and necessary database batch size. Avoid flaky wall-clock thresholds in normal tests. All 44 workload measurements enforce explicit ceilings alongside result and metadata checks, including 101-target relationship writes across the 100-ID boundary. Both normal verification and default native SQL jobs run them; an injected extra query demonstrably stops the gate. See [budgets and scope](docs/development/query-measurements.md#enforced-query-budgets).
- [ ] **A8-04** Replace proven per-record fetch bottlenecks with bounded batched reads, preserving authorization, complete results, ordering, and per-parent limits. Simplify and migrate hook contracts if that removes otherwise unnecessary per-record work. Target locks, existing canonical edge lookups and target validation now use bounded batches with measured reductions; canonical removal/replacement no longer reads the complete old membership. Bulk resource writes, reverse child PATCH lifecycles and consumer migration remain. See [target validation and remaining work](docs/development/query-measurements.md#relationship-target-validation).
- [x] **A8-05** Review the per-ID fallback in get-related.js and eliminate proven unnecessary fetches; verify endpoint results and include behavior against the selected contract. Earlier query work already removed the fallback. Review and native conformance confirm constrained collection queries and the required to-one GET lifecycle; additional 2/10/40-member cases verify constant query counts, visibility, sparse fields and polymorphic includes. See [the endpoint review](docs/development/query-measurements.md#related-endpoint-review).
- [x] **A8-06** Batch relationship validation/include work where authorization and customization apply consistently. Keep a fallback only for a demonstrated supported need, not to emulate retired hooks. Existing include batches and single-query collection limits now pair with 100-target minimal validation batches, per-target read permissions and a database-collation lookup when needed. Full target GET validation is removed, with explicit hook migration. Node 24 full suites and 2,616 native cases pass; consumer ports remain under Part M/A8-12. See [validation evidence](docs/development/verification-progress.md#2026-09-10-batched-relationship-target-validation).
- [x] **A8-07** Bound batch sizes to database parameter limits and memory use; test large relationship collections and repeated IDs. Target locks, canonical existing-edge reads, ordinary pivot writes, identifier visibility, belongs-to includes, canonical parent-link prefetches and target minimal reads now have explicit batch bounds. Collection/reverse-linkage predicates deduplicate IDs and keep large PostgreSQL/SQLite lists in a single bound parameter, preserving SQL sorting and limits; MySQL retains its verified text-protocol query. Canonical removal bounds each DELETE to 100 distinct requested IDs; replacement uses one complete exclusion predicate verified with 33,000 IDs. Canonical reverse linkage now fetches only identity/reference columns, with measured row-byte reduction and full/native verification. Plain conversion now shares one type/ID lookup per document, removing measured quadratic searches. Ordinary pivot reads now use 100 requested targets and at most 101 physical rows per page; replacement uses one complete keep-list deletion, and database-equivalent requested targets are deduplicated before insertion. Canonical parent-link prefetch also pages physical rows and constrains the declared target resource. Sparse fieldsets now avoid omitted collection hydration and to-one visibility reads in both storage modes while retaining explicit includes and selected linkage filtering. Explicit includes now avoid preliminary linkage and select limited targets before loading parent mappings in bounded pages. Ordinary SQL bigint primary/reference reads, relationship writes and generated IDs now retain exact identity values. Final response normalization now removes internal dependency metadata after enrichment. Include maps now share primary resource identities and linkage, plain conversion indexes primary resources too, and canonical default linkage preserves explicit include limits (A8-F20). Explicit empty include documents and refresh links are corrected under A2-16 (A8-F21). Reverse additions/removals now read only requested IDs in batches, and replacement pages at most 101 removed identities while preserving complete keep-lists, database ID equality and child PATCH lifecycles (A8-F22). Canonical linkage now applies target permissions and filters before fetching link rows, removing full hidden-edge/visibility intermediates (A8-F23). Input/result allocation has been reconciled, including tested isolation of full responses with 100/1,000/5,000 children from after-commit observers. The last confirmed intermediate, canonical attachment of duplicate physical edges, now uses at most 101 rows per page and retains at most 100 requested-ID matches (A8-F24). Full Node 24 verification and 787 selected native checks pass, including late-page rollback, edge locks and explicit case-insensitive MySQL IDs. All eight relevant 44-workload reports retain their previous counters. The allocation criterion is complete with the documented whole-input/output costs; per-child lifecycle work and consumer verification remain under A8-04/A8-12. See the [allocation review and findings](docs/development/query-measurements.md#relationship-allocation-review).
- [x] **A8-08** Verify permissions/autofilters/row policies apply before limits and counts, and no cache or batch result can cross tenant/auth boundaries. The source/test review covers collection and related pagination, standard/window includes, pivot policies, reference search/sorting, batched visibility/validation, caller changes, borrowed visibility and tenant descriptor/result isolation. Collection helpers now honor replaced filter builders and restore enclosing query metadata. Node 24 full verification and 2,514 selected native cases pass. See [authorization evidence and scope](docs/development/verification-progress.md#2026-09-10-collection-filtering-and-authorization-review).
- [x] **A8-09** Cache compiled metadata and safe request-local lookups where measurements justify it; avoid unbounded or authorization-blind caches. Existing published descriptors and scalar contracts retain measured reuse; request contracts retain one correctly keyed variant. Registry descriptors now retain at most 100 recent entries, and temporal normalization retains at most 40 common contracts without rejecting unusual precision. Borrowed metadata and authorization results are not published into these caches. Full Node 24 verification and 1,802 selected native cases pass with unchanged query budgets. See [retention decisions and limits](docs/development/query-measurements.md#metadata-cache-retention).
- [x] **A8-10** Examine real query plans for key scenarios, including nullable sorting. Recommend or generate indexes only through the library's existing schema/migration mechanisms. A populated fixture explains eleven public operation shapes before/after candidate indexes in both modes on SQLite/PostgreSQL/MySQL. The review identifies owner/reference indexes and residual sorts; SQLite now uses native null ordering to avoid a full sort where its existing index can supply order. Ten new regressions, full Node 24 verification and 1,890 selected native cases pass. See [plans, recommendations and limits](docs/development/query-plans.md).
- [x] **A8-11** Add regression tests for query counts, complete results, hidden fields, per-parent limits, and callback counts after each optimization. The [regression map](docs/development/query-measurements.md#optimization-regression-coverage) reconciles all five requirements across implemented optimizations, including existing workload ceilings, exact membership, visibility, window limits and child/permission callbacks. The latest expansion verifies exact getter/computation identities and sparse dependency removal; all 282 selected checks pass across SQLite/PostgreSQL/MySQL and both storage modes. Future optimizations must extend their affected regressions; A8-04/A8-12 remain open. See [acceptance evidence](docs/development/verification-progress.md#2026-09-11-optimization-regression-acceptance).
- [ ] **A8-12** Record before/after measurements and consumer regression results. Retain an optimization only when its benefit is demonstrated.

Acceptance: measured bottlenecks improve without changing result semantics, authorization, or extension behavior.

## A9. Add useful internal type checking and diagnostics

Primary files: checked JSDoc definitions, internal helpers/adapters, new type-check configuration, and logging/error utilities.

- [x] **A9-01** Introduce incremental `checkJs`/JSDoc checking with no required runtime transpilation step. Storage, transaction and selected query implementation modules now opt into strict TypeScript checking through `@ts-check`, with `noEmit`; see [scope and contracts](docs/development/typechecking.md).
- [ ] **A9-02** Define shared types for compiled resources, field definitions, storage capabilities/adapters, resource identifiers, query descriptors, and result representations.
- [ ] **A9-03** Define stage-specific context guarantees without creating a duplicate runtime context hierarchy; annotate the existing helpers and actual mutation points.
- [ ] **A9-04** Check storage and lifecycle boundaries first, then expand to the internal modules changed by this plan.
- [ ] **A9-05** Resolve real shape mismatches and missing adapter members. Avoid blanket `any`, broad suppressions, or type assertions that conceal unknown behavior.
- [x] **A9-06** Add compile-time negative fixtures proving invalid adapter calls and incompatible stage/result shapes are detected.
- [ ] **A9-07** Add stable diagnostic fields for operation, resource, phase, backend, and transaction state through existing logging facilities; preserve error causes.
- [ ] **A9-08** Redact sensitive attributes and bound logged payload size. Test diagnostics using hidden fields, uploaded-file metadata, and nested errors.
- [ ] **A9-09** Publish declarations for the selected public surface and validate library, jskit-ai, and app consumers. Remove old overloads and aliases from types alongside the runtime migration.
- [x] **A9-10** Add the type check to verification and document the scope that remains dynamically typed. `npm run verify` and its existing CI job run `npm run typecheck`; [the scope document](docs/development/typechecking.md) identifies the remaining unchecked lifecycle, plugin and query bodies and declaration work.

Acceptance: checking catches meaningful interface errors, diagnostics identify the failing phase, and declarations describe the selected runtime/package contract used by migrated consumers.

## A10. Make documentation and release artifacts dependable

Primary files: `README.md`, `docs/`, `tests/README.md`, package configuration, examples, and publication smoke tests.

- [ ] **A10-01** Reconcile documentation with the selected API and migration map. Correct stale hook, transaction, serializer, error, and option examples, keeping a short before/after migration guide.
- [ ] **A10-02** Consolidate repeated reference explanations and link tutorials to one authoritative description of each contract.
- [ ] **A10-03** Replace long repetitive implementation comments with concise invariant/decision comments where appropriate; retain useful public JSDoc and examples.
- [x] **A10-04** Execute representative documentation and migration-guide examples, covering actual imports, configuration, outputs, hooks, and supported drivers/connectors. The executable corpus includes 66 SQL tutorial scenarios and six migration-snippet scenarios across SQLite/PostgreSQL/MySQL and both storage modes, Fastify injection, Express 5/4 file/Socket.IO examples, standalone HTTP servers, prior API/quickstart/relationship and data-migration examples, and extracted-package import checks. [Acceptance evidence and limits](docs/development/verification-progress.md#2026-09-11-representative-documentation-execution-a10-04-complete) distinguish representative execution from the still-open full prose audit and consumer migration.
- [x] **A10-05** Update contributor/testing instructions to use the shared fixtures, real integration commands, type checks, and full verification gate. The consolidated `tests/README.md`, linked development guide, root README and repository instructions now describe the selected API and separate verification scopes; links/script names and the documentation build pass.
- [x] **A10-06** Document backend capabilities and limitations clearly, including temporal precision, real S3 availability, migrations, and externally owned transactions. Do not claim unsupported features were implemented by this roadmap. The [backend reference](docs/GUIDE/BACKEND_CAPABILITIES.md) consolidates verified combinations, unverified dialects, precision/storage differences, migration limits, managed/raw ownership, mock S3 and the paused positioning failure; detailed contracts remain linked to their owning guides.
- [x] **A10-07** Define an explicit npm file allowlist for runtime code, supported declarations/imports, license, and selected documentation. Exclude tests, development notes, and agent configuration from publication. The manifest now selects runtime JS/declarations, license, README, API/quickstart and guides. The existing packed-package gate verifies the exact file set before compiling the consumer; 148 files replace the previous 444-file package. See [package evidence](docs/development/verification-progress.md#2026-09-11-package-content-allowlist). Consumer import migration and clean installation remain under A10-08–10.
- [ ] **A10-08** Inventory actual deep imports before publication changes; migrate library, jskit-ai, app, and generated callers to the selected paths. Remove obsolete paths rather than shipping forwarding aliases; test optional-peer loading.
- [ ] **A10-09** Pack/install the actual tarball into temporary consumers and paired jskit-ai/app checks, exercising selected imports, optional plugins, a minimal API, declarations, and exact dependency resolution.
- [ ] **A10-10** Test clean dependency installation under supported Node versions in the library and migrated consumers, inspect scoped lockfile changes, and keep development tooling out of mandatory runtime dependencies.
- [x] **A10-11** Document a coordinated breaking-version and consumer-dependency update procedure; wire local/CI gates to real verification commands and keep unrelated version/release work separate. The [release procedure](docs/development/releasing.md) covers source reconciliation, candidate versions, exact-artifact consumer/seed checks, dependency/lock updates and publication order without executing paused consumer work or publishing. CI now requires the existing clean-package command alongside library/native jobs; its aggregate rejects all non-success combinations. The actual Node 24 clean installation passes core/optional-peer checks and both storage-mode CRUD checks. [Acceptance evidence](docs/development/verification-progress.md#2026-09-11-coordinated-release-procedure-and-required-package-job) distinguishes local verification from unexecuted hosted CI and consumer acceptance.
- [x] **A10-12** Rebuild documentation and repeat package-content checks after documentation, declaration, and publication changes. Following the declaration entry point, file allowlist and backend-guide changes, docs rebuild and the exact packed-content/type gate pass: 149 files, 27 runtime exports, 10 negative type checks. The [artifact evidence](docs/development/verification-progress.md#2026-09-11-backend-reference-and-artifact-reconciliation) records its hash and scope. Future publication/doc changes must continue running these checks; this does not replace final C2 artifact or paired-consumer verification.

Acceptance: the published artifact is intentional, installation smoke tests pass, and documented contracts are exercised rather than merely described.

# Part B — API simplification and separately scoped capabilities

B0 contains the agreed core API simplifications. B1–B4 remain separate capability work, with explicit cost and prerequisites; they are not prerequisites for the first B0 migration. Reuse an existing mechanism if it fully supplies the required capability. If a simpler shared mechanism satisfies two items, implement it once and record both sets of evidence.

B0 selects format/returning terminology. Other names and exact signatures are chosen from consumer evidence before implementation. Breaking changes and changed defaults are permitted through Part M migration; optional concurrency remains an explicit application choice. Do not add aliases or dual runtimes to simulate obsolete behavior.

## B0. Simplify the existing light ORM API

Dependencies: M-01–M-06 for affected consumers, existing A0 evidence, and focused contract tests. Complete this before investing in exhaustive preservation of the old option matrix. The [API migration guide](docs/GUIDE/MIGRATING_API_V2.md) accompanies implementation and must distinguish selected targets from shipped behavior.

- [x] **B0-01** Inventory every read/write/relationship call convention and distinguish payload data, query options, operation controls, and context. Keep resource declarations, resource access, and familiar CRUD names unless a demonstrated problem warrants changing them. The [call-convention inventory](docs/development/resource-call-inventory.md) reconciles all fourteen data operations, registered supporting methods and transaction/context exceptions with runtime registration and declarations. Executed API reference examples pass in both storage modes and the packed public-type/content check passes. This closes the library-surface inventory, not Part M's external call-site inventory or migration.
- [x] **B0-02** Specify `format: 'plain' | 'jsonapi'` across single reads, queries, resource writes, related resources, and linkage endpoints, including input/output shapes, empty results, includes, and metadata. Clarify any endpoint that inherently returns linkage rather than a record.
- [x] **B0-03** Specify `returning: 'full' | 'minimal' | 'none'`, exact result shapes, and applicable operations. Define programmatic and HTTP defaults plus resource/per-call precedence without hidden transport-specific core modes or boolean aliases.
- [x] **B0-04** Select one write argument convention separating record fields from controls; favor explicit `inputRecord` and the existing ID option. Specify context and transaction placement consistently. Prove fields named format/returning/id/queryParams cannot be accidentally interpreted as controls inside record data.
- [x] **B0-05** Record the old/new API and configuration map, selected defaults, and removed spellings in the short migration guide. Include jskit-ai's plain user/workspace calls, JSON:API CRUD calls, errors, and transaction forwarding.
- [x] **B0-06** Implement the selected options and argument contract using existing operation/representation helpers where appropriate. Remove old simplified/returnFullRecord/boolean-alias parsing instead of adding synonyms.
- [ ] **B0-07** Make connectors select their required JSON:API representation and return behavior explicitly at the boundary. Update query/request contracts, CORS where affected, and HTTP/client/assistant consumers of changed options or payloads.
- [ ] **B0-08** Migrate library tests, fixtures, plugins, examples, declarations, and configuration to the new API. Preserve behavioral assertions; delete tests whose only purpose was an obsolete alias after replacement-contract coverage exists. The [local migration audit](docs/development/local-api-migration.md) finds only deliberate literal shorthand rejection and schema-validation calls in source, and one labelled old example in migration JavaScript. The paused positioning guide still shows plain JSON at a JSON:API HTTP endpoint; dynamic-call evidence is now reconciled, leaving that explicitly paused example as the remaining local gap.
- [ ] **B0-09** Port jskit-ai and downstream callers through Part M in the same batch, including templates and generated repositories. Verify plain/JSON:API consumers, field mappings, policies, includes, and pagination against the selected API.
- [x] **B0-10** Test malformed/removed options, data/control name collisions, default/override precedence, every applicable response mode, and programmatic/real-HTTP parity. Removed options must fail clearly rather than silently change request meaning.
- [ ] **B0-11** Audit consumer wrappers, including jskit-ai temporal normalization and missing/fieldset error translation. Remove demonstrated library workarounds after equivalent direct behavior is tested; retain domain integration that still serves a purpose.
- [ ] **B0-12** Execute the migration-guide examples against packaged library and consumer artifacts, verify regeneration emits new calls, and search for remaining legacy spellings/imports or compatibility branches before marking the API migration complete.

Acceptance: CRUD calls remain straightforward, response options are explicit, data and controls cannot collide, consumers and generators call the new API directly, and the migration guide is short, accurate, and executable.

## B1. Machine-readable transaction outcomes on errors

Dependencies: A7; integrate with B2 and transport error handling.

- [x] **B1-01** Define the public outcome states and their exact meaning: acknowledged commit, acknowledged rollback, unknown outcome, and any necessary distinction for a still-active caller-owned transaction or no transaction. The [selected contract](docs/GUIDE/transaction-outcomes.md) defines `none`, `pending`, `committed`, `rolledBack` and `unknown`, with ownership, confirmation, snapshots, per-entry bulk outcomes and retry limits. Vocabulary and B1-03 population are complete; B1-02/B1-04/B1-05 still require consumer migration.
- [ ] **B1-02** Choose stable machine-readable outcome metadata and useful typed error fields, preserving original causes and nontransactional diagnostics. Migrate jskit-ai/app error classification if the error contract changes.
- [x] **B1-03** Populate outcomes from transaction evidence. A thrown commit operation must not be reported as definitely rolled back without confirmation. The existing completion helpers require method/completion evidence, recognize PostgreSQL's ROLLBACK acknowledgment, retain unknown outcomes without confirmation and reject owned savepoint release. Full Node 24 gates and 2,494 selected native cases pass; [scope and limitations](docs/development/verification-progress.md#2026-09-10-owned-savepoints-and-managed-transaction-contract) keep managed completion and real network-failure guarantees under B2/A7.
- [ ] **B1-04** Surface a post-commit hook failure as an acknowledged-commit outcome with a clear error/result contract; migrate consumer handling and prevent blind retries of committed writes.
- [ ] **B1-05** Carry safe outcome metadata through programmatic errors, HTTP JSON:API errors, bulk results, and applicable Socket.IO acknowledgments. Update real consumer error handling and status mapping tests together.
- [x] **B1-06** Test commit failure, rollback failure, secondary cleanup errors, borrowed transactions, non-extensible errors, and successful commit followed by hook failure. Resource/relationship/bulk/registry, file and lifecycle failures assert outcome snapshots and preserved causes; the Node 24 gates, 6,226 selected SQL cases and 92 Redis cases pass. See [exact evidence and limits](docs/development/verification-progress.md#2026-09-10-write-error-outcomes-and-retry-guidance).
- [x] **B1-07** Document examples explaining when application retries could duplicate a committed write; avoid presenting the outcome as a general automatic-retry guarantee. The [migration guide](docs/GUIDE/MIGRATING_API_V2.md#transactions-and-errors) explains generated-ID POST duplication after notification failure, unknown completion, pending ownership and external effects despite rollback.

Acceptance: migrated applications distinguish materially different write outcomes using stable metadata and handle post-commit failures without unsafe automatic replay.

## B2. A managed transaction helper

Dependencies: A4, A7, B1.

- [ ] **B2-01** Inspect the library, Knex, and jskit-ai database-runtime transaction helpers. Select one ownership model and integrate with or replace the existing consumer helper, rather than adding a competing abstraction.
- [x] **B2-02** Specify callback arguments/return values, transaction ownership, rollback propagation, and how operations enlist their after-commit/rollback work. The [selected managed transaction contract](docs/GUIDE/managed-transactions.md) defines `api.transaction(callback, context?)`, actual Knex participation, one completion owner, failed-unit propagation, ordered completion chains, per-operation context ownership and raw-transaction migration. This completes specification only. Implementation is in progress in the working tree; focused tests pass, but broader migration and verification remain unfinished.
- [x] **B2-03** Implement transaction creation, awaited callback execution, commit, rollback, and result propagation with explicit ownership and no implicit process-global transaction state. The actual Knex callback handle uses the existing completion helper; synchronous/awaited values retain identity and completion hooks are awaited. Private ownership also survives changes to diagnostic context flags. See [implementation and native evidence](docs/development/verification-progress.md#2026-09-10-managed-ownership-registry-and-concurrency).
- [x] **B2-04** Ensure resource and relationship operations inside the helper participate in the same transaction and do not finalize it individually. Resource, nested relationship, atomic bulk and canonical registry writes share the owner. Lifecycle/concurrency tests verify pending visibility and owner-only completion on both storage modes and all three databases; consumer integration remains under B2-01/B2-10.
- [x] **B2-05** Queue transaction-dependent events/cleanup until the actual outer outcome; run hooks the documented number of times and in a deterministic order. The producer audit covers resource/relationship chains, file cleanup, Socket.IO queues and bulk diagnostic finalizers. Overlapping writes verify enlistment/reverse-enlistment hook order separately from notification capture order. A7-F09 now attempts every finalizer without replacing an earlier failure. The full Node 24 gate and 1,646 selected PostgreSQL/MySQL checks pass; see [ordering evidence](docs/development/verification-progress.md#2026-09-10-completion-order-and-finalizer-failures). Broader file ownership and extension-error guarantees remain under A7.
- [x] **B2-06** Define nesting behavior explicitly. Support an established safe nesting model or reject unsupported nesting clearly; do not silently commit an outer transaction or imply savepoint support. Every helper call creates an independent top-level unit; compose one unit by passing its handle. Tests verify independent callback commits survive outer rollback, and raw/child-savepoint library writes reject without completing their parent. See [the nesting contract](docs/GUIDE/managed-transactions.md#nesting-and-consumer-migration).
- [ ] **B2-07** Specify the retained raw Knex transaction contract or migrate all affected callers to the selected managed mechanism. Retain raw SQL participation where consumers need it; do not maintain a separate legacy ownership/event mode.
- [x] **B2-08** Test mixed resource/relationship/bulk operations, callback rejection, intermediate failure, commit/rollback failure, and after-commit failure on both backends and real databases. The 11-file Node 24 selection passes 837/837 per SQLite mode, 856/856 per PostgreSQL mode and 838/838 per MySQL mode. It includes exact lifecycle traces, driver completion failures, original/secondary error assertions and concurrent owners. This is selected coverage; the full gate and remaining file/event integration stay open.
- [x] **B2-09** Test upload cleanup and Socket.IO events under helper-owned commit and rollback, including multiple operations affecting the same resource. Eighteen new actual-file cases and sixteen WebSocket/polling cases cover repeated writes, callback/caught-write/caught-SQL failures, cleanup failure, commit timing and failed completion chains. The Node 24 selection passes 287/287 per SQLite mode, 173/173 per PostgreSQL mode and 169/169 per MySQL mode. Runtime code is unchanged; obsolete-file removal, the broader ordering audit and consumer migration remain open. See [managed side-effect evidence](docs/development/verification-progress.md#2026-09-10-managed-files-and-notifications).
- [ ] **B2-10** Migrate jskit-ai/app transaction helpers and call sites, remove overlapping wrappers, add selected imports/types, and execute one successful multi-operation example and one rollback example from the migration guide.

Acceptance: one coherent transaction mechanism supports library operations and needed raw SQL across migrated consumers, with explicit ownership and correct event/cleanup timing.

## B3. Optional optimistic concurrency

Dependencies: A3, A5–A7, B1; verify conditional-request semantics against the HTTP specification during implementation.

The [implementation review](docs/development/optimistic-concurrency.md) records
storage boundaries, version representation decisions and HTTP validator
constraints. B3 behavioral and public-contract acceptance is complete. Broader
automatic API typing and coordinated consumer migration remain in A9/M.

- [x] **B3-01** Select explicit resource configuration and an expected-version argument within the new method/options contract; version checks remain opt-in because they require deliberate application/data participation. `versionField` selects a declared stored string attribute, and `expectedVersion` conditions direct PUT-update/PATCH/DELETE calls. POST initializes a token; conditional creation rejects. See the implementation review for verified scope and unfinished relationship/bulk/HTTP behavior.
- [x] **B3-02** Specify version initialization, representation, increment rules, and which resource/relationship changes invalidate a version. Define behavior for PUT-create, deletion, bulk operations, and simplified responses. The migration guide's revision table specifies opaque UUID initialization/rotation, direct and inverse membership effects, deletion/recreation, bulk child conditions, transaction rollback and shared JSON:API/plain semantics. Tokens do not validate included/computed representations; external SQL, triggers and transitive database cascades require application revision maintenance. Implementation race/tenant acceptance, side effects, HTTP validators and public types remain under B3-04/06/07/08/10/11.
- [x] **B3-03** Provide explicit schema/migration guidance for the stored version. Do not alter existing application tables silently or expose an internal version field unexpectedly. The guide and executable backfill cover deliberate field allocation, output visibility, per-row tokens, retry/rollback, canonical tenant/resource scoping and restart. Six cases pass in all six native database/storage combinations; no consumer migration has been applied.
- [x] **B3-04** Implement the expected-version predicate and update/increment atomically in the database, including tenant and authorization constraints. Avoid a separate read-check-write race. Authorized public writes use an adapter-scoped UPDATE with byte-exact expected-version matching and fresh-token assignment in the write transaction. Native same-token concurrency, rollback and collation checks pass; overlapping tenant/resource rows with matching IDs and tokens remain unchanged. SQL row-policy denial precedes token acceptance/disclosure across direct and relationship methods. This preserves existing authorization semantics; it does not make arbitrary external authorization changes or SQL writers atomic with application callbacks. Broader relationship races, side effects and HTTP validators remain in their B3 items.
- [x] **B3-05** Map failed conditions to a stable typed error, distinguishing inaccessible/missing resources from version conflicts without leaking hidden rows. Exported `RestApiVersionConflictError` carries a stable code through write wrappers and the HTTP error mapper. Direct and relationship methods preserve identical hidden/missing responses; conditional PUT-create now uses not found. Native policy/error cases and HTTP regressions pass.
- [x] **B3-06** Add optional HTTP ETag/If-Match support using correct strong-comparison semantics; account for response variants and any representation changes involving includes/computed fields. Opted-in GET/HEAD hash the emitted JSON bytes; registered resource writes compare the selected GET inside a serializable transaction. Native tests cover includes, computed dependencies, caller visibility, response replacement/failure, same-tag concurrent clients and normal-error precedence. Framework serialization ownership and external-effect boundaries are documented. Public declarations and coordinated consumer migration remain separate open work.
- [x] **B3-07** Define malformed, absent, multiple, wildcard, and weak validator handling explicitly. Test unconditional operations under the selected API without imposing a concurrency condition implicitly. The selected handling table documents bounded grammar, strong lists, empty/weak/wildcard behavior, opt-in defaults, ignored non-representation methods and explicitly unsupported routes. Real Express/Fastify/Express 4 checks verify unconditional writes, failure before mutation on unsupported routes, GET/HEAD conditions and ignored OPTIONS conditions. Broader representation, hook, dependency and public-type acceptance remains under B3-06/10/11.
- [x] **B3-08** Ensure conditional failures do not run successful-write hooks, change relationships, leave uploads, or emit committed-change notifications. Native tests verify stale direct/relationship writes run no success/commit hooks, preserve resource/membership state, and clean rejected uploads. Caller-transaction rollback cleans earlier successful uploads and restores membership/revisions; real WebSocket/polling clients receive no update from failed direct writes, rolled-back caller transactions or atomic bulk PATCH/DELETE. Accepted-write controls verify hooks and notifications are active. Earlier successful operations can run pre-commit hooks; application irreversible effects belong after commit.
- [x] **B3-09** Test two genuine concurrent clients using the same version: one conditional update succeeds and the stale operation cannot overwrite it. Run on real databases and both storage modes. Public PATCH calls synchronize before mutation on separate transaction connections; both response formats pass across SQLite/PostgreSQL/MySQL and both modes. A PostgreSQL mutation run removing the predicate makes both race tests fail because two writes succeed.
- [x] **B3-10** Test version behavior for transactions, supported bulk/relationship writes, rollback, PUT-create, DELETE, and both HTTP connectors. Reject unsupported combinations explicitly before partial work. Native tests cover direct JSON:API/plain writes, successive caller-transaction revisions and rollback, supported relationship methods and same-revision races, atomic/non-atomic bulk conditions and body-level conditions through Express/Fastify. Unsupported bulk/header combinations reject before mutation. The acceptance evidence table is in the verification log; HTTP protocol/rendering acceptance and public types remain under B3-06/11.
- [x] **B3-11** Add public types, runnable consumer examples, CORS exposure/allow-header guidance, and tests of unconditional operations under the selected API. Root-exported version configuration, direct/relationship/bulk conditions, errors and HTTP/CORS options pass strict packed-consumer compilation and negative checks. The runnable HTTP client and unconditional direct/HTTP writes pass 20 focused checks across both storage modes; migration/backfill examples and CORS guidance are documented. Automatic schema/API inference and actual app validation remain under A9/M.

Acceptance: opted-in callers prevent lost updates through an atomic condition, while unconditional operations remain available through the selected API.

## B4. Predictable read-error handling

Dependencies: A4, A7, B1.

- [x] **B4-01** Inventory remaining deliberately nonfatal getter, computed-field, and include failures. Distinguish them from invalid input, denied access, expected missing data, and best-effort cleanup failures.
- [ ] **B4-02** Select one clear default for unexpected getter/computed/include failures, preferring error propagation over silent partial success. Add an explicit best-effort option only for a demonstrated consumer requirement; migrate callers and avoid a legacy-default switch solely for compatibility.
- [x] **B4-03** Implement the selected error policy consistently at shared boundaries, retaining original causes and useful field/resource/phase context.
- [x] **B4-04** Ensure strict read failures cannot be mistaken for successful partial results and strict write-response failures occur before owned transaction commit.
- [x] **B4-05** Keep post-commit and cleanup failures governed by their own transaction semantics; strict mode must not imply that a committed write can be rolled back. Source review and 150 focused native checks verify committed-error reporting without rollback, retained primary errors and continued completion/cleanup chains across both storage modes. Sixteen additional temporary-file cases preserve warning diagnostics and successful writes without conflating cleanup with strict read failures. B4 consumer acceptance remains separate.
- [x] **B4-06** Test primary/included getters and computed fields, all include kinds, nested/plain output, generic throws, and typed errors under the chosen default and any justified explicit policy.
- [ ] **B4-07** Test real HTTP/programmatic parity, policy precedence, transaction outcomes, and migrated jskit-ai/app handling of failed responses.
- [x] **B4-08** Document the selected policy and migration examples, explaining any former partial-success responses that now become errors. Do not imply an error can undo an acknowledged commit.

Acceptance: migrated consumers receive the selected, documented error behavior consistently; an optional best-effort mode exists only if a concrete need justifies it.

# Part C — Final review and completion

## C1. Review changes in three distinct passes

- [ ] **C1-01** Review every milestone against its acceptance conditions in production code and tests across all changed repositories; verify each architectural change earns its complexity.
- [ ] **C1-02** Review the whole final patch for contract and migration completeness: methods, payloads, options/defaults, imports, hook/context behavior, transaction ownership, supported backends, and separately scoped capabilities across library, jskit-ai, and apps.
- [ ] **C1-03** Perform an adversarial pass over interactions: malformed values, nulls, sparse fields, custom IDs, serializers, projected sorts, empty/cyclic relationships, auth boundaries, hook mutations, failures, and concurrent operations.
- [ ] **C1-04** Check that links, cursors, schemas, imports, declarations, generated source, and migration/documentation examples are accepted by their actual current consumers.
- [ ] **C1-05** Check for duplicate normalization/validation, global state, stale caches, swallowed errors, speculative adapters, excessive mode flags, old/new API translation, and any runtime layer maintained solely for backward compatibility.
- [ ] **C1-06** Confirm deleted/moved code has no remaining library, jskit-ai, app, template, or generated callers. Verify removed aliases/imports are absent from runtime and published declarations.
- [ ] **C1-07** Add regression tests for confirmed final-review findings and fix them before repeating affected checks.

## C2. Verify and report

- [ ] **C2-01** Run the final complete library gate and jskit-ai/downstream-app checks against the same intended artifacts, including both storage modes, real databases/connectors, lint, types, docs, examples, and package installation.
- [ ] **C2-02** Record actual test/pass/fail/skip counts per job, source revisions, package resolution, runtime/driver versions, commands, and conditions. Explain every material coverage limitation.
- [ ] **C2-03** Compare final query budgets, performance measurements, initialization costs, and package contents against A0 baselines.
- [ ] **C2-04** Run git diff --check in each changed repository and inspect final status/diffs for generated artifacts, unintended dependency changes, and interference with the concurrent expansion.
- [ ] **C2-05** Reconcile every checklist item and migration decision against the latest jskit-ai expansion and app inventory. Unexecuted required work stays open and the execution goal must not be marked complete.
- [ ] **C2-06** Produce a self-contained report separating internal improvements, API changes/capabilities, and jskit-ai/app migrations, with exact verification, fixed defects, performance evidence, and limitations.
- [ ] **C2-07** Mark the execution goal complete only after required implementation, the jskit-ai and vibe64 migrations, artifact verification, documentation, and the final report are complete.

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
| 2026-09-09 | Revision 2; M/B0 preparation | Incorporated authorized breaking changes, downstream-app ports, expansion coordination, no runtime compatibility layers, and architectural justification; added 14 migration and 12 API simplification items while retaining all 188 original IDs | [Consumer snapshot and 65 passing baseline tests](docs/development/consumer-migration.md), [target API migration guide](docs/GUIDE/MIGRATING_API_V2.md), and archived revision 1; baseline tests resolve the installed consumer dependency, not the future artifact | 24/214 verified items; API implementation and all migrations remain open. Complete app inventory, settle contracts, and verify paired artifacts |

| 2026-09-09 | Scope clarification | Maintainer selected vibe64 as the only downstream app in this goal; other apps will be ported later within their own repositories | Part M and completion scope updated; migration guide remains a required deliverable for owner-managed later ports | Continue library, jskit-ai, and vibe64 work; do not wait for or modify other apps |

## Design decision log

For each material decision, record the problem, existing mechanisms considered, smallest chosen solution, compatibility impact, and tests proving it. In particular, record the A4 helper boundary, schema invalidation strategy, adapter capability contract, and B1–B4 public surfaces here before implementing them.

Revision 2 selects format and returning as replacement options and authorizes coordinated breaking changes. Defaults and payload details are settled under B0 with consumer evidence; historical decisions below remain evidence for completed work, not a requirement to emulate every former behavior.

- API migration: retain the light ORM resource/CRUD model, replace ambiguous format/return controls directly, keep payload data separate, and port the sole direct consumer plus its apps. Remove obsolete spellings and forwarding layers. See B0, Part M, and the migration guide; exact defaults and context details remain open until inspected and specified.
- Architecture: a local fix or simpler public contract may satisfy an internal improvement with less code than a new abstraction. Each A4–A6 change records the demonstrated problem and evidence; an unimplemented capability is never counted complete through a design-only decision.
- Concurrent expansion: the consumer inventory is provisional. Recheck current source and generated templates before each migration and again after the expansion; neither an eight-hour estimate nor passing tests against old installed packages proves readiness.

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

### Execution objective for revision 2

Execute `/home/merc/Development/current/json-rest-api/library-improvement-plan.md` revision 2 to completion, including all 214 identified items and their acceptance conditions. Retain the library's light ORM character while implementing the approved format/returning and argument simplifications, justified internal improvements, and separately tracked API capabilities. Breaking API/default/import/hook changes are authorized with coordinated migration of jskit-ai and vibe64. Revalidate evolving consumer source during the ongoing expansion, migrate templates and generated code, remove obsolete paths without runtime compatibility layers, and verify the exact intended artifacts through real consumer workflows. Complete required backend/connector, failure/concurrency, typing, performance, documentation/package checks and three final reviews. Maintain exact checklist/evidence and report migrations, internal changes, and API capabilities separately. Remote publishing/deployment is outside scope. Do not count unimplemented, unavailable, deferred, or unverified required work as complete.

The goal service is active after the maintainer instructed execution to continue. Its stored objective still cites revision 1 and 188 items; available tools cannot edit that text. The maintainer's newer instructions and this revised objective govern execution. Do not mark the old goal complete to replace its wording, and do not claim the stored text has been edited.

All required Part M, Part A, Part B, and Part C outcomes are implemented or demonstrably satisfied with recorded evidence. The library retains its light ORM usefulness with the selected simpler API; current jskit-ai, vibe64, and its public/accounts seeds are ported and verified against intended artifacts; no runtime compatibility layers remain; required checks and three review passes are complete; and the maintainer has received the final report. Planning, elapsed time, and tests against an older installed library do not establish completion.

### 2026-09-09 — Catalog-selected seeds and package-check evidence

M-01 is complete: [consumer evidence](docs/development/consumer-migration.md) records paths, revisions, dirty-work boundaries, dependencies, generators, and verification commands for jskit-ai, vibe64, and both branches in vibe64's installed Genesis catalog. This incorporates the maintainer's explicit seed scope; other apps remain later owner-managed ports. The tarball runner passed 65 selected jskit-ai tests and checks of failure/interruption cleanup. Vibe64 onboarding passed 11 tests; each seed smoke passed one. The accounts smoke did not exercise database CRUD. M-04 remains open until paired migrated jskit-ai artifacts are also selectable in the accounts seed. Verified total: **25/214 (11.7%)**.

### 2026-09-09 — Response API implementation batch in progress

Core response options now use strict string values, scalar plugin/resource defaults and per-call overrides. HTTP resource routes explicitly request JSON:API/full; DELETE and relationship mutations return no body. Input records no longer autodetect JSON:API, and shorthand writes are being ported. The first migrated jskit-ai tarball check passed 73 selected tests (including user repository forwarding). Final suite results and migration completion remain pending.

Two adjacent defects are fixed with regression tests: relationship HTTP handlers dropped the second-argument request context; getRelationship dropped the caller transaction before its nested read. Additional findings remain part of open A2/A8 work: generic object fields currently need a getter to parse SQLite JSON strings; getRelated builds a public search filter for its parent constraint and fails when that relationship is not searchable. Format tests use an explicitly searchable relationship and an explicit JSON getter; they do not claim these outstanding general behaviors are fixed.

### 2026-09-09 — Core option contract implemented and verified

B0-02–B0-06 are complete. The [migration guide](docs/GUIDE/MIGRATING_API_V2.md) specifies input/output shapes, linkage exceptions, scalar defaults and call/resource/plugin precedence, explicit HTTP JSON:API/full behavior, second-argument context and first-argument transaction placement, removed names/maps/booleans, and before/after consumer calls. `response-options.js` replaces the former return-settings parser; resource writes require `inputRecord`; the existing representation helpers still own conversions, with no input-format autodetection or compatibility aliases.

The migrated format matrix runs 60 cases per backend, including POST, PUT-create, PUT-replace, PATCH, read shapes, includes, and all return modes. Invalid options, field/control collisions (including a data object containing type), and removed spellings have regression coverage. Real Express relationship tests prove request-context forwarding for all five routes and uncommitted linkage visibility under a borrowed transaction. HTTP parity checks deliberately use plain/none programmatic defaults to exercise the explicit JSON:API/full boundary. Fastify is still simulated in that file; real Fastify remains A3 work.

Full commands on Node 22.16.0 / SQLite: regular **577 passed / 578 total**, zero failures, one existing skip (42.381 s); AnyAPI **574 passed / 575 total**, zero failures, one existing skip (31.235 s). Expanded lint passed. Docs rebuilt successfully (8.794 s before the final evidence entry). Current jskit-ai host and CRUD/user/workspace repository source changes passed **73 selected tests** against the packed new library on Node 26.5.0 (11.170 s), and all nine changed JS files passed the consumer's ESLint. The quickTest example completed its programmatic calls and real HTTP include/filter checks, then shut down cleanly.

No consumer lockfile or installed package was changed. Artifact/dependency coordination, the accounts seed port, remaining documentation and wrapper review, real database/connector work, later capabilities, and final audits remain open. Current verified checklist total: **30/214 (14.0%)**.

### 2026-09-09 — Paired package verification and real account persistence

M-04 is complete. The consumer runner now selects both the actual library tarball and the required current jskit-ai tarballs in a disposable app install, reusing jskit-ai's existing workspace/version helpers. It verifies every selected package location and host-to-library resolution through ordinary npm resolution. Library-only checks previously established jskit-ai/vibe64 selection; paired checks now cover both catalog-selected seeds. The public seed and vibe64 currently have no library-backed workflow, so resolution checks do not imply database integration there.

The real accounts-seed database check exposed six repositories still sending JSON:API documents while expecting plain output. They now send plain fields and relationship IDs directly, with explicit format and outer PATCH IDs; redundant document builders were removed. All **352 tests** across the four affected jskit-ai packages pass, and the 13 changed JS files pass consumer lint. The accounts seed's new explicit database integration test passes **1/1** against **MariaDB 12.0.2** with 21 current jskit artifacts, covering registration, profile persistence across sessions, rejected authentication, and separate users' settings. The disposable server/data directory were cleaned up.

Both seeds' full `npm run verify` commands pass on Node 26.5.0 against paired artifacts: package checks, lint, one server test, one client test, and production build each. Candidate dependency files are staged below the seeds' existing lint exclusion and hidden from automatic app-test discovery; no app verification rules were relaxed. [Consumer evidence and reproduction](docs/development/consumer-migration.md) records scope, commands, artifact identity, and limitations. Coordinated versions/dependencies, templates, remaining workflows, browser and other driver/connector coverage, and final audits remain open. Verified checklist total: **31/214 (14.5%)**.

### 2026-09-09 — HasMany related reads corrected; mutation defects confirmed

The earlier non-searchable getRelated finding is fixed for direct and polymorphic hasMany relationships. Parent membership now passes logical field/value constraints to the existing storage adapters independently of public search filters, before limits/counts. Public filters are preserved and intersected, and pagination links remain on the related-resource route. A small internal symbol/helper scopes the constraint to the intended query; nested independent queries reset it. The change replaces duplicated query branches without a new public option, schema mutation, or alternate parser.

[Conformance evidence](docs/development/conformance.md) includes 20 new shared related-collection cases, reverse polymorphic reads, row-policy/autofilter isolation, and real Express link traversal. Initial reproduction: 10 failures in 23 tests. Final focused runs: 62 regular/63 AnyAPI passes. Full suites: **599 regular/596 AnyAPI passes**, zero failures and one existing skip each; expanded lint and all **352 affected jskit-ai tests** against the packed library pass. The full-suite hardwired-backend limitations remain documented.

The adjacent mutation audit confirmed on both backends that hasMany POST/DELETE fail by sending forbidden raw foreign-key attributes, while hasMany PATCH reports success without changing membership. These remain open under A2/A4/A7, alongside hasOne and cross-parent mutation coverage and many-to-many batching. This completed fix does not satisfy a whole remaining checklist item. Verified total remains **31/214 (14.5%)**.

### 2026-09-09 — Relationship writes and endpoint coverage verified

A2-03 is complete, with an explicit [resource and relationship endpoint map](docs/development/conformance.md#resource-and-relationship-endpoint-map). The new reverse-write suite adds 42 shared cases across standard/custom child IDs, mapped foreign keys, hasOne uniqueness, polymorphic links, complete replacement beyond query caps, and owned/borrowed transaction failures. All five relationship methods have persisted-result assertions across the applicable relationship kinds; real Express requests cover to-many writes and pagination. The resource suites cover GET/query/POST/PUT-create/PUT-replace/PATCH/DELETE. The broader format, ID, permission, driver and concurrency combinations retain their own open items.

Reverse mutations now share one ordinary helper that computes membership changes and calls existing child PATCH operations with the caller context/transaction. It replaces the failing raw foreign-key writes and silent reverse-PATCH no-op. Explicit nulls now reach field validation. Additional fixes preserve many-to-many replacement context, deduplicate serial additions, honor mapped pivot columns and aliased targets, and retain both polymorphic discriminator fields in sparse linkage reads. An invalid older fixture now uses the documented polymorphic relationship declaration and asserts real linkage instead of two ordinary attributes. No compatibility parser or operation framework was added. The [migration guide](docs/GUIDE/MIGRATING_API_V2.md#review-relationship-writes) documents the resulting write, nullability, permission and transaction behavior.

Final full SQLite commands on Node 22.16.0: **646 regular /643 AnyAPI passes**, zero failures, one skipped test each; durations **49.180/52.186 s**. Mode-specific skipped suites and hardwired fixtures are disclosed in [verification progress](docs/development/verification-progress.md). Library lint and diff checks pass. All **352** tests in the four affected jskit-ai packages pass against a packed library containing these runtime changes; the later changes only corrected library fixtures/assertions and documentation. Full consumer migrations, managed transactions/outcomes, real-driver concurrency, many-to-many related-query behavior/performance, and final triple reviews remain open. Verified checklist total: **32/214 (15.0%)**, comprising **A 25/138, B 5/48, M 2/14, C 0/14**.

The documentation build passed after the guide and evidence updates (**2.653 s**); the final diff check also passed.

### 2026-09-09 — Real connector execution and response matrix verified

A2-04 and A3-07 are complete. The [connector coverage map](docs/development/conformance.md#real-connector-defaults-and-validation) combines the 60-case programmatic format/default/return matrix with related-read/option boundaries and 78 real HTTP cases per backend. Express 5.1.0 and Fastify 5.12.3 run actual request handling with all three programmatic return defaults, a resource return override, both accepted JSON content types, resource/relationship operations, sparse fields, pagination links, coercion/nulls, typed errors and trusted URL handling. The old fake route invocation was removed; three focused registration/schema tests retain a small fake. `npm run test:connectors` runs both backend commands and passed **81/81 each**, with no failures/skips.

Real execution exposed Fastify startup failing on exported schema metadata and Express returning HTML for malformed JSON. Fastify's supported route validator interface now uses the existing compiled request contract, retaining its errors/coercion without another field-stripping parser. Request context precedes Fastify validation so response hooks handle failures. Express body-parser errors now use the existing JSON:API error handler, and route error handling is awaited. The [Fastify guide](docs/GUIDE/GUIDE_X_Fastify.md) and [migration guide](docs/GUIDE/MIGRATING_API_V2.md) explain the selected behavior; no app-wide validator replacement or compatibility layer was added.

Final full SQLite runs on Node 22.16.0: **717 regular /714 AnyAPI passes**, zero failures, one skipped test each, **54.637/57.784 s**. All **352** tests in the affected jskit-ai packages passed against a packed library containing the runtime changes; its temporary install was removed. Lint, final diff check and the documentation build (**2.568 s**) pass. [Detailed evidence](docs/development/verification-progress.md) records the initial failures, artifact hash, command results and skip limits. Express 4/remaining framework versions, real databases, HTTP boundary/body-limit/content-negotiation cases, multipart, remaining API and consumer migrations, and the final triple review remain open. Verified checklist total: **34/214 (15.9%)**, comprising **A 27/138, B 5/48, M 2/14, C 0/14**.


### 2026-09-09 — HTTP boundaries and Express 4/5 matrix verified

Completed **A3-08/A3-09**. Real Express 4.22.2, Express 5.1.0 and Fastify 5.12.3
now run the shared connector behavior on both storage modes. This batch fixes
media-type substring matching, missing Accept negotiation, forbidden response
charset parameters, fractional page truncation, lost literal query question
marks, ignored unknown fieldset resource types, Express prefix/error boundaries,
and Fastify bodyless JSON DELETE parsing. Fastify uses one scoped set of routes
and parsers, preserving custom host parsers. Its old fake has been removed.

The final `npm run verify` on Node 22.16.0 passed **789/790 regular** and
**786/787 AnyAPI** tests (one existing skipped test each), **72/72 Express 4**
cases per backend, lint and docs. All **352 jskit-ai tests** passed against the
packed runtime on Node 26.5.0. The migration guide records changed statuses,
headers and query behavior; its optional Fastify malformed-URL host setup was
executed against the real framework. [Detailed evidence](docs/development/verification-progress.md)
records the artifact, command results, initial failures and coverage limits.

Fastify's default malformed-URL error occurs before connector hooks and remains
a documented host boundary. Multipart, real PostgreSQL/MySQL, CORS/Socket.IO
failure interactions, remaining API/consumer migration, and the three final
review passes remain open. Verified checklist total: **36/214 (16.8%)**,
comprising **A 29/138, B 5/48, M 2/14, C 0/14**.

### 2026-09-09 — Real multipart uploads and cancellation verified

Completed **A3-10** with native Busboy 1.6.0 and Formidable 3.5.4, real HTTP
streams, Express 4/5 resource routes and both SQLite storage modes. Tests exposed
broken detector imports and Busboy API usage, swallowed parser failures,
incorrect multipart write input, missing size limits and temporary-file cleanup,
and prototype-like field names lost in shared write validation. The fixes reuse
the canonical write input and existing schema validation. Native cancellation
tests wait for partial disk writes before disconnecting and verify cleanup and
owned rollback. Caller-owned transaction cleanup remains open under A7/B2.

The full gate passed **836/837 regular** and **833/834 AnyAPI** tests (one
existing skipped test each), **96/96 Express 4** tests per backend, lint and docs.
All **352 jskit-ai tests** passed against the packed runtime. The revised upload
guide's actual quick-start example passed a multipart POST and exact-byte read
from its stored URL. The migration guide describes parser limits, status codes
and the buffered file result. [Detailed evidence](docs/development/verification-progress.md)
records failures, versions, commands and remaining limits.

Verified checklist total: **37/214 (17.3%)**, comprising **A 30/138, B 5/48,
M 2/14, C 0/14**. Real PostgreSQL/MySQL coverage, transaction and failure
semantics, performance, types, remaining API/consumer migrations and final
triple review are still required.

### 2026-09-09 — CORS failures and response-hook execution verified

Verified progress within **A3-11**, with its Socket.IO review still open. Fifty-five
new real connector tests per full backend job cover CORS on early and resource
errors, async origin permission/denial/failure, preflights, zero cache age, Vary
merging and response hooks that fail while handling an existing error. Express
and Fastify now use the shared response lifecycle for those boundaries and
attempt response hooks once. The CORS implementation reuses `vary` for header
parsing; its ignored numeric hook ordering option was removed. The migration
guide describes the changed error envelopes and hook-visible early requests.

The full gate passed **891/892 regular**, **888/889 AnyAPI** (one existing skipped
test each), **124/124 Express 4 per backend**, lint and docs. All **352 jskit-ai
tests** passed against the packed runtime. The CORS guide's actual setup example
passed allowed/denied preflights, a write and a malformed-body response.
[Detailed evidence](docs/development/verification-progress.md) includes the
initial failures, artifact identity, test counts and remaining Socket.IO work.

No additional whole checklist item is checked in this batch. Verified total
remains **37/214 (17.3%)**: **A 30/138, B 5/48, M 2/14, C 0/14**.

### 2026-09-09 — Socket.IO rejection and write notifications verified

Completed **A3-11**, following the CORS batch above. Seventy-two new contract
cases use actual Socket.IO clients over WebSocket and polling on both storage
modes and Express 4/5. They cover authentication and subscription rejection,
concurrent admission limits, permissions revoked after subscription, every
matching subscription, filter entry/exit, CRUD and relationship notifications,
HTTP writes, and no events on validation or owned-transaction rollback. The
original twelve cases now use ordered acknowledgements instead of fixed sleeps.

The implementation fixes subscription validation and capacity races, awaits
custom filter predicates, preserves subscription data through JSON encoding,
rechecks query permission before notification, and emits parent relationship
updates once. The migration guide records the smaller subscription contract,
consistent event names and string IDs; no compatibility aliases were added.
The Socket.IO guide's actual example passed subscription, HTTP write, event,
fetch and unsubscribe against a live local server.

The full gate passed **963/964 regular**, **960/961 AnyAPI** (one existing skipped
test each), **196/196 Express 4 per backend**, lint and docs. All **352 jskit-ai
tests** passed against the packed runtime. [Detailed evidence](docs/development/verification-progress.md)
records the regression failures, artifact identity and limits. Full row-policy
isolation, borrowed transaction outcomes, notification failure/cleanup semantics
and live Redis verification remain open; these tests do not establish them.

Verified total: **38/214 (17.8%)**: **A 31/138, B 5/48, M 2/14, C 0/14**.
Real PostgreSQL/MySQL coverage, remaining internal/API changes, coordinated
consumer migrations and all three final review passes are still required.

### 2026-09-09 — ID domains and mapped relationships verified

Completed **A2-05** with 64 shared cases per backend, supplemented by the
existing custom-ID suites, normalization overrides, real HTTP link-following
and executed SQLite migrations. Confirmed defects included zero IDs lost or
overwritten during writes and includes, opaque IDs colliding with inherited
object keys, invalid object coercion, unencoded Location headers, integer
columns falling through to strings, and AnyAPI PUT demanding already supplied
polymorphic fields again. Fixes reuse existing normalization and validation;
the migration guide documents the resulting ID and URL contracts.

The final full gate passed **1045/1046 regular**, **1042/1043 AnyAPI** (one
existing skipped test each), **203/203 Express 4 per backend**, lint and docs.
The dedicated ID command passed **96/96 regular** and **92/92 AnyAPI**. All
**352 jskit-ai tests** passed against the final packed runtime. A deterministic
test also exposed and corrected a filesystem-event race in the upload test
observer; five actual cancellation/observer cases passed on each backend.
[Detailed evidence](docs/development/verification-progress.md) records initial
failures, artifact identity, final results and coverage limits.

Verified total: **39/214 (18.2%)**: **A 32/138, B 5/48, M 2/14, C 0/14**.
Real PostgreSQL/MySQL coverage, broader schema and transaction contracts,
remaining API/consumer migrations and all three final review passes remain open.

### 2026-09-09 — Temporal conformance and AnyAPI serializers verified

Completed **A2-07** with 64 shared cases per backend: 57 public/storage cases
and seven explicit driver/extension representation cases. The matrix covers
both formats, all write-return options, temporal domains and limits, offsets,
precision, stored SQL representations, native getters/setters/computed values,
includes, sparse fields, cursor traversal and custom serializers. Actual
PostgreSQL/MySQL driver and column capabilities remain A3/A5 requirements.

AnyAPI now retains callable storage metadata, uses the existing serializer
contract for writes and comparisons, and supplies write context/operation
metadata. Its duplicate private filter pass and three unused coercion helpers
were removed. Built-in storage rejects offsets outside the four-digit UTC year
range before writes, including no/minimal-return requests. Tests verify stored
bytes, exact public values, one serialization per filtered query and rollback
on serializer failure. The migration guide records these contracts and removed
deep exports; scoped consumers use none of those exports.

The full gate passed **1109/1110 regular** (one existing skip), **1107/1107
AnyAPI**, **203/203 Express 4 per backend**, lint and docs. The dedicated temporal
command passed **140/140 regular** and **135/135 AnyAPI**, and all **352 jskit-ai
tests** passed against the final packed runtime. The historical AnyAPI serializer
skip is removed. [Detailed evidence](docs/development/verification-progress.md)
records initial failures, corrected test assumptions, artifact identity and limits.

Verified total: **40/214 (18.7%)**: **A 33/138, B 5/48, M 2/14, C 0/14**.
Real database/CI coverage, remaining internal/API work, coordinated consumer
migrations and all three final review passes remain required.

### 2026-09-09 — Query selection, filtering and related pagination verified

A2-09 is complete. The shared query matrix executes 89 cases per backend plus
two regular pivot-hook cases. It checks both formats, explicit filter/count
expectations, sparse projections, tied/null/projected sorts, caps, generated
links, joined searches, related membership and duplicate rows. Many-to-many
reads now use SQL membership subqueries through the target collection query,
removing per-member reads. Tests cover inverse links, nested-query isolation,
query denial/filters, borrowed rollback and fixed SQL round trips.

Confirmed fixes also cover null inequality, split OR searches, OR BETWEEN,
invalid ranges, disabled counts, ambiguous AnyAPI join columns, distinct parent
counts and unsupported includes. The migration guide documents changed results,
validation and read hooks; scoped source searches found no consumers of the
removed many-to-many GET/pivot-query hook sequence.

The final full gate passed **1207/1208 regular** (one existing skip),
**1203/1203 AnyAPI**, **206/206 Express 4 per backend**, lint and docs.
The dedicated query command passed **153/153 regular** and **151/151 AnyAPI**.
All **352 selected jskit-ai tests** passed against the final packed runtime;
temporary installation cleanup and package resolution were verified.
[Conformance](docs/development/conformance.md) and
[verification evidence](docs/development/verification-progress.md) record the
regressions, exact results, artifact identity and coverage limits.

Verified total: **41/214 (19.2%)**: **A 34/138, B 5/48, M 2/14, C 0/14**.
The next A2-10 audit has reproduced hidden-parent IDs leaking through belongsTo
linkage; it remains open alongside the full authorization matrix. Remaining
internal/API capabilities, real databases, migrations and all three final review
passes are still required.

### 2026-09-09 — To-one linkage visibility fixed; A2-10 continues

The hidden-parent identifier reproduction from the query audit is fixed for
primary and included belongsTo/polymorphic linkage. The existing AnyAPI
identifier filter now uses shared storage adapters in the existing relationship
module; GET/query reuse it at the response boundary. Row-policy/autofilter and
borrowed-transaction context are preserved, with queries grouped by target type.
Canonical ID comparison was corrected after six zero-ID regressions exposed
numeric binding against text logical IDs. No stored relationship is cleared.

The new authorization suite has **56 shared cases per backend**, including
policy/workspace denial, sparse and included records, endpoint linkage, related
counts, full write responses and caller rollback. Full verification passed
**1263 regular** (one existing skip), **1259 AnyAPI**, **206 Express 4 per
backend**, lint and docs. Dedicated authorization checks passed **84 regular /
85 AnyAPI**, and **352 jskit-ai tests** passed against the final packed runtime.
The migration guide documents the changed identifier visibility and existing
plain-null convention. [Evidence](docs/development/verification-progress.md)
records exact runs, artifact identity and test corrections.

A2-10 remains open for method-level permissions, bulk/notification visibility
and the rest of its adversarial matrix. Verified total remains **41/214 (19.2%)**:
**A 34/138, B 5/48, M 2/14, C 0/14**. Other required implementation, coordinated
migrations and all three final reviews remain open.

### 2026-09-09 — Bulk authorization and reused write context verified

The next A2-10 batch adds **56 bulk cases per backend**: row-policy/workspace and
independent write denial, atomic rollback and partial success, both formats and
all return modes, zero IDs and real Express/Fastify requests. The bulk plugin's
obsolete route hook, dropped request context, ignored atomic query values and
discarded DELETE summary are fixed. Bulk POST/PATCH now use existing response
option helpers and ordinary CRUD results without a fallback GET.

Denied entries exposed a stale committed flag copied from a previous write,
leaving a new transaction open and exhausting the SQLite pool. The seven write
methods now reset commit state. **16 shared context tests per backend** cover
owned rollback, borrowed ownership, and PUT replacement/creation. The latter
also exposed stale original-input/minimal-record snapshots; common request
setup clears them. These are local fixes using the existing lifecycle helpers.

Full verification passed **1335 regular** (one existing skip), **1331 AnyAPI**,
**217 Express 4 per backend**, lint and docs. The latest packaged jskit-ai check
passed **353 tests**, with package resolution and source preservation verified.
The migration guide documents the new bulk behavior and context corrections.
No jskit-ai, vibe64 or seed source was edited in this batch; vibe64's advancing
integration/source-editor work was inspected only. Earlier migration edits
remain in jskit-ai and the accounts seed. Exact revisions, artifacts, failed
reproductions, test corrections and passing gates are in the
[verification evidence](docs/development/verification-progress.md).

A2-10 remains open for target method permissions on includes/linkage and the
notification/adversarial matrix. Broader context/transaction handling, bulk
argument/configuration cleanup, real drivers, migrations and final reviews are
still required. Verified count remains **41/214 (19.2%)**, with **A 34/138,
B 5/48, M 2/14, C 0/14**.

### 2026-09-09 — Execution paused; unfinished jskit-ai migration parked here

At the maintainer's request, the exact migration diff for the 13 identified
jskit-ai files was saved to
[pending-jskit-ai](docs/development/pending-jskit-ai/README.md), with full Git
blob IDs, source revision, per-file checksums and reapplication instructions.
Applying and reversing it in a temporary directory reproduced both versions
byte for byte. After verifying the saved artifact, its changes were reversed
from the active jskit-ai checkout. All 13 files match their recorded base;
2,008 other non-ignored files, the source HEAD and Git index were unchanged.
The saved patch passes a forward apply check against the restored checkout.

No separate worktree or stash was created. The accounts seed and vibe64 were
not changed by this parking operation. M-08 explicitly links the archive and
requires reconciliation with current jskit-ai plus the remaining migration.
The implementation goal stays paused until the maintainer requests resumption;
its scope and verified count remain **41/214 (19.2%)**.

### 2026-09-09 — Library work resumed; consumer checkouts remain untouched

The maintainer explicitly resumed implementation while excluding jskit-ai and
vibe64 for now. Work is confined to json-rest-api, including its documentation
and local fixtures. The seed repositories and parked migration are also left
untouched. Part M and consumer-dependent acceptance checks remain open; earlier
consumer artifact results are historical and do not verify this later runtime.

The A2-10 continuation reproduced a target permission bypass in to-one
`getRelated`: no-field/no-include requests returned a parent include instead of
calling target GET. The new 93-case regression suite initially had 45 failures,
including real Express/Fastify HTTP 200 responses for forbidden reads. Removing
that shortcut reuses target GET for every selection. Parent permission checks
retain full parent attributes; the linkage lookup requests only target IDs when
parent and target types differ. No helper or compatibility branch was added.

`conformance-related-permissions` now has **96 cases per backend** covering
belongsTo/polymorphic/hasOne, both formats, fields/includes/no selection, all
three target GET permission hooks, awaited finish behavior, zero/mapped IDs,
parent data permission checks and borrowed transactions. Its HTTP cases also
run under Express 4. All 96 passed on each storage mode. The first combined
run exposed an incorrect new test assumption that generic resource errors
include a wire `code`; the corrected assertion checks the existing HTTP 403
status/detail independently from the programmatic typed error.

The full gate after that runtime fix passed: **1431/1432 regular tests** (one
existing skip), **1427/1427 AnyAPI**, **226/226 Express 4** per mode, lint and
documentation. Log: `/tmp/library-related-permissions-full-gate.log`.

The Socket.IO audit then reproduced custom SQL callbacks being mistaken for
attribute filters: the plugin looked for a function-valued `filterOperator`
instead of the core's existing `applyFilter`. Both admission validation and
snapshot matching now use `applyFilter`, requiring/awaiting `filterRecord`.
The real socket tests use a working mapped SQL callback and independently
assert ordinary query results. Both 84-test socket runs pass; logs:
`/tmp/library-socket-custom-filter-before.log` (two expected regression failures)
and `/tmp/library-socket-custom-filter-sql-final.log` (passing both backends).
Full SQL operator parity and row-policy notification visibility remain open.

[The conformance guide](docs/development/conformance.md#independent-write-and-response-invariants)
now defines independent expectations and executed evidence for all six A2-11
invariants. This closes the definition/evidence item without claiming unbuilt
transaction outcomes, caller-owned bulk, concurrency, or final audit coverage.
Verified total: **42/214 (19.6%)**, with **A 35/138, B 5/48, M 2/14, C 0/14**.

The combined runtime gate passed again after the Socket.IO correction with the
same test counts, plus lint and docs:
`/tmp/library-resumed-auth-final-gate.log`. A test-only review then added four
self-type polymorphic cases, checking parent full-attribute authorization and
target GET denial when both records have the same resource type. The focused
authorization command passed **274 regular / 275 AnyAPI**, zero failures/skips
(`/tmp/library-resumed-auth-self-related.log`). The parked patch SHA-256 was
rechecked unchanged. The goal service still reports its user-controlled
`paused` flag; this turn resumed implementation by explicit user instruction,
but no available goal tool can change that flag to enable automatic continuation.

The continued source review found the same parent-fieldset problem in
`getRelationship`. A direct GET denied a named parent while linkage returned
success because its internal GET forced an ID-only fieldset. A standalone
fixture reproduced the missing rejection (exit 1,
`/tmp/library-linkage-parent-permission-before.log`). Removing that internal
fieldset retains the parent's data checks while returning only linkage.
The first three permanent regressions passed within **277 regular / 278
AnyAPI** authorization checks. Coverage was then expanded across all six
relationship shapes and both HTTP connectors; the related-permission file now
contains 114 cases per backend. The migration/hook guides explain the change
and distinguish direct GET's requested fieldset from its full `minimalRecord`.

The preceding reviewed gate passed its two full suites and Express 4 jobs,
then correctly failed lint on two property-layout errors in the newly added
self-type test. The layout was corrected and lint passed. That run
(`/tmp/library-resumed-auth-reviewed-gate.log`) is not recorded as a passing
complete gate; the expanded linkage patch requires the final gate below.

Final expanded-patch gate: **1453/1454 regular SQLite** (one existing skip),
**1449/1449 AnyAPI SQLite**, **232/232 Express 4** per backend, lint and docs,
all successful, exit 0. Durations were 34.873 s / 39.417 s for the full suites,
4.579 s / 5.117 s for Express 4, and 2.209 s for docs. Log:
`/tmp/library-resumed-auth-linkage-final-gate.log`. Runtime/tests were then
left unchanged; only final evidence prose was updated. `git diff --check`
passed. No same-pattern include-result shortcut remains in resource methods;
the remaining `included.find` is a serializer lookup, not a GET substitute.
The verified total remains **42/214 (19.6%)**. A2-10, cross-repository migration
and the other open capabilities/final review items remain unfinished.


### 2026-09-09: subscriber SQL visibility (A2-10 continued)

The goal service is active again. Library work continues under the consumer hold;
no jskit-ai, vibe64 or seed changes or consumer checks were made.

Socket.IO previously disclosed changed IDs despite subscriber row-policy or
workspace restrictions. Eligibility now reuses ordinary resource queries in the
write transaction before/after mutation. It uses server-owned subscription
context and the existing internal changed-ID constraint, removing the duplicate
JavaScript filter matcher and the draft `filterRecord` requirement. Queue entries
capture operation values and subscription generations. Relationship POST/DELETE
now provide before-data-call hooks, documented in the migration guide.

The new 60-case shared suite covers both transports, CRUD and relationships,
policy/workspace isolation, query failure, context reuse, replacement subscriptions,
non-atomic bulk and atomic rollback, SQL operators/joins and membership changes.
The focused socket command passed 144/144 per backend; setup-only failures and
fail-before/pass-after runtime evidence are distinguished in
[verification progress](docs/development/verification-progress.md).

A2-10 stays open for remaining include/linkage action-permission cases. A7/B2
also retain successful atomic bulk notification delivery: the current bulk plugin
commits directly without running the outer after-commit hook. Do not count atomic
rollback tests as proof of successful atomic delivery. Real drivers, live Redis,
transaction outcomes, query costs and the rest of the full plan remain open.
The count stays **42/214 (19.6%)**, A35/138, B5/48, M2/14, C0/14.

The complete library gate passed on Node 22.16.0:
**1513/1514 regular** (one existing skip), **1509/1509 AnyAPI**, **292/292
Express 4** per mode, lint and docs, exit 0. Evidence:
`/tmp/library-socket-policy-full-gate.log`. The parked migration checksum is
unchanged. This verifies the current batch, not Part C's final three review passes.


### 2026-09-09: include permissions, pivot filtering and plain graphs

A2-10 now has executed target-query permission checks for includes and identifiers,
including default linkage, all six relationship shapes, nested reads and real
HTTP. The shared filtering boundary enforces those permissions without adding a
second read lifecycle. Regular many-to-many pivot discovery, window queries and
linkage now apply pivot permissions/policies before limits. AnyAPI canonical links
remain a separate documented storage capability.

The audit also reproduced and fixed plain nested includes losing relationships:
the existing converter now expands the available include graph, preserves leaf
and partial-membership identifiers, and terminates cycles per path. Repeated
siblings/primary records expand independently. No second normalizer or compatibility
layer was introduced. A2-08 conformance is strengthened by these regressions.

The expanded suite passes 72 selected-backend cases plus 12 explicit regular-pivot
cases in each invocation; five direct graph cases also pass. The complete gate
passes **1602/1603 regular** (one existing skip), **1598/1598 AnyAPI**,
**304/304 Express 4** per mode, lint and docs, exit 0. Log:
`/tmp/library-include-plain-full-gate.log`. Fail-before evidence and the earlier
failed gate are distinguished in [verification progress](docs/development/verification-progress.md).
The migration guide explains the new permission checks and plain nested shapes.
Consumer repositories, seeds and the parked migration remain untouched.

A2-10 remains open: the next audit has reproduced hidden related attributes
influencing cross-resource search matches/counts on both backends, despite hidden
direct reads and null linkage. The permanent join regressions and visibility fix
are next; passing include checks do not establish join isolation. The total stays
**42/214 (19.6%)**, A35/138, B5/48, M2/14, C0/14. Part C remains uncompleted.


### 2026-09-09: authorized search joins and canonical reference fields

Cross-resource and polymorphic joins now reuse each target storage adapter and
query-filtering boundary, with target query permissions, row policies and workspace
filters applied inside joined selections. This preserves independent primary OR
matches and applies visibility before filtering/counting. Nested polymorphic joins
are constructed for every requested path regardless of filter argument order.

The regressions also exposed missing AnyAPI scalar-ID slots, numeric IDs stored as
`"1.0"` in TEXT slots, and relationship backing attributes disclosing hidden IDs.
The existing registry/mappers now allocate and bind those IDs correctly and omit
relationship backing fields from public attributes, matching regular storage.
Existing slot positions survive descriptor reload/re-registration in the tested
unchanged declaration. General schema evolution remains open. Migration and policy
guides document the response changes and `search-join` query purpose.

The new suite passes **44/44 per backend**, including twelve real HTTP cases,
combined polymorphic paths, sparse/plain representation, caller transaction
visibility, distinct reverse counts and stored-value/slot persistence. The complete
Node 22.16.0 gate passes **1646/1647 regular** (one existing skip), **1642/1642
AnyAPI**, **310/310 Express 4** per mode, lint and docs, exit 0. Log:
`/tmp/library-search-visibility-full-gate.log`; fail-before and corrected test-setup
evidence is distinguished in [verification progress](docs/development/verification-progress.md).
The parked migration checksum is unchanged; consumers and seeds remain untouched.

A2-10 stays open: a follow-up inspection reproduces an inference through explicitly
searchable relationship backing IDs despite null response linkage on both modes.
The next batch must cover/fix direct ordinary and polymorphic reference filters;
the joined-attribute fix does not establish that separate path. Real-driver,
transaction/notification, schema/storage, performance/type, migration and final
review work remains open. The verified total is **42/214 (19.6%)**:
**A35/138, B5/48, M2/14, C0/14**. No Part C review is counted complete.


### 2026-09-09: reference filters and lossless typed query links

Direct belongs-to keys, their search aliases, polymorphic ID/type fields and
reference fields on joined targets now use target query permissions and scoped
visibility. The existing operator helper compares the original storage column
for a visible reference and SQL NULL otherwise, retaining OR matches, affinity
and collation. The implementation uses existing storage adapters and query-filter
hooks; it adds no per-record API calls or duplicate value normalizer.

Pagination review reproduced null filters disappearing from generated links.
The shared query parser/serializer now uses `filter[field][json]` for explicit
JSON values, preserving nulls, arrays, embedded commas and empty lists. Plain
filter strings remain literal strings. Malformed typed JSON returns HTTP 400 with
`source.parameter` naming the query key. The migration and row-policy guides
explain the URL contract and unchanged programmatic value convention.

Focused verification passes 99/99 per invocation: ninety selected-backend search
cases, one fixed regular SQLite collation case, and eight parser cases. This
includes self references, shared IDs across polymorphic types, caller changes,
borrowed transactions, operators, counts, forward/backward pagination and 28 real
HTTP cases. Corrected test setup mistakes and failed SQL prototypes are recorded
separately in [verification progress](docs/development/verification-progress.md).

The final reviewed complete gate, including the query-error-source fix, passed
1695/1696 regular (one existing skip), 1691/1691 AnyAPI, 318/318 Express 4 per
mode, lint and docs, exit 0 on Node 22.16.0. Full-suite durations were
45.269/56.951 s; Express 4 took 12.479/12.553 s. Log:
`/tmp/library-reference-filters-reviewed-gate.log`. The preceding gate and
fail-before error-source evidence are recorded separately. Consumer repositories,
seeds and the parked migration remain unchanged; `git diff --check` passes.

A2-10 remains open: if an application explicitly allows sorting by a relationship
backing key, current cursors expose that hidden reference value despite null
linkage. Both modes reproduce it in `/tmp/library-reference-sort-inspection.log`.
The next batch must handle sorting, cursor comparison and output together; hiding
only the serialized value would make pagination inconsistent. The total remains
**42/214 (19.6%)**, A35/138, B5/48, M2/14, C0/14. Part C and the other open
internal/API/migration requirements remain unfinished.

### 2026-09-09: reference sorting and cursor visibility verified

Built-in reference sorts now use the target's query permission, row policy and
workspace filter through the existing `search-join` selection boundary. A filtered
source lookup provides a column that is NULL for hidden/missing targets and
retains the source column's affinity/collation for visible targets. Both sorters
use that same value for ordering, cursor comparisons and cursor metadata/links.
Private selected values are removed before response preparation and avoid names
used by schema fields, mapped columns and query projections. No compatibility
layer, duplicate normalizer or per-record API lookup was introduced.

The new suite contains 54 selected-backend cases plus two explicit regular SQLite
NOCASE cases. It covers row policies/workspaces, aliases and default sorts,
ordinary/polymorphic/self references, null ties, multiple keys, complete cursor
traversals, sparse/plain output, includes and joined filters, caller changes,
borrowed transactions, conflicting AnyAPI tenant/resource rows and fourteen real
Express/Fastify cases. Review reproduced and fixed temporary-column collisions.
Test setup mistakes and fail-before results are distinguished in
[verification evidence](docs/development/verification-progress.md).

The final Node 22.16.0 `npm run verify` gate passed, exit 0:
**1751/1752 regular** (one existing skip), **1747/1747 AnyAPI**,
**325/325 Express 4** per mode, lint and docs. Durations were 55.300/70.993 s
for the full suites, 17.687/18.453 s for Express 4, and 4.769 s for docs.
Log: `/tmp/library-reference-sorting-full-gate.log`. Migration/policy guides now
explain null reference sorting and starting a fresh cursor traversal after
upgrading. Consumer repositories and seeds were untouched; the parked migration
checksum is unchanged and `git diff --check` passes.

The broader authorization/capability audit, including remaining include-limit
behavior, stays open. Real drivers, internal lifecycle/schema/transaction work,
later APIs, migrations and Part C remain unfinished. No new checklist item is
counted complete: **42/214 (19.6%)**, A35/138, B5/48, M2/14, C0/14.

### 2026-09-09: collection include limits verified; A2-10 complete

The shared include-limit suite now executes 75 cases on each actual backend:
ordinary/reverse-polymorphic/many-to-many collections, both response formats,
global and per-parent strategies, mapped and projected ordering, duplicate links,
borrowed transactions, explicit zero/null limits, hidden-reference ordering and
six real HTTP cases. The initial 24 cases failed on both backends. The runtime
now uses one helper for ordering/limiting already-filtered selections and retains
parent membership through per-parent ranking. Regular loaders share their repeated
selection/filter sequence; AnyAPI applies the same include contract and canonical
link query for related reads. Global limits count unique targets, including
shared many-to-many members. The superseded three deep query helpers were removed
without forwarding exports; migration guidance records that change.

The [A2-10 reconciliation](docs/development/conformance.md#a2-10-authorization-coverage-reconciliation)
maps all required primary/include/linkage/count/pagination/bulk/representation
surfaces to executed tests, including the earlier search, cursor, context and
subscriber visibility fixes. This completes the shared SQLite authorization
coverage item, not A2-16's remaining capability map or Part C's final audit.

Node 22.16.0 `npm run verify` passes, exit 0:
**1826/1827 regular** (one existing skip), **1822/1822 AnyAPI**,
**328/328 Express 4** per mode, lint and docs. Durations were 45.868/53.565 s
for the full suites, 10.925/10.854 s for Express 4 and 2.111 s for docs.
Log: `/tmp/library-include-limits-full-gate.log`. The focused 319-case runs,
global-grouping review failure and final 75-case results are distinguished in
[verification evidence](docs/development/verification-progress.md).

Consumer repositories, seeds and the parked migration remain untouched;
`git diff --check` and the archive checksum check pass. Required real databases,
remaining configuration/capability coverage, lifecycle/schema/transaction work,
later APIs, migrations and the final reviews remain open. Local tool discovery
finds MariaDB 12.0.2 and `pg_config`, with no Docker/Podman or PostgreSQL server
command in PATH; isolated real-driver setup is next and no backend job is yet
counted complete. Verified total: **43/214 (20.1%)**, A36/138, B5/48, M2/14, C0/14.

### 2026-09-09: disposable PostgreSQL/MySQL environments; A3-01 complete

The [real-database runner](docs/development/real-databases.md) now starts private
PostgreSQL/MySQL servers and runs both storage modes. Shared fixtures allocate
separate databases and drop them after success or initialization failure. The
runner checks readiness, bounds subprocesses, stops process groups on interruption,
and removes its server directories. No system service or consumer repository is
used. `pg` and `mysql2` are development dependencies.

Real execution exposed and fixed canonical startup defects: PostgreSQL registry
inserts need returned IDs; repeated schema setup needs an actual index lookup;
MySQL metadata foreign keys must match unsigned primary keys and one generated
index name exceeded its identifier limit. Index lookup extends the existing
introspection module. The environment suite also restores/enforces the unique
index and verifies repeated setup does not abort a borrowed transaction.

All six environment jobs pass **4/4** (24 total) on SQLite, PostgreSQL 16.15 and
MySQL 8.0.46, each with regular/AnyAPI storage. Failure, SIGINT, SIGTERM and missing
server checks pass **4/4** per database, including removed-directory and stopped-PID
assertions. See [verification evidence](docs/development/verification-progress.md)
for reproduction, initial failures, final logs and actual test scopes.

The full Node 22.16.0 `npm run verify` passes: **1830/1831 regular** (one existing
skip), **1826/1826 AnyAPI**, **328/328 Express 4** per mode, lint and docs. Log:
`/tmp/library-database-environment-full-gate.log`; full suites took 36.853/57.132 s,
Express 4 12.811/19.407 s, docs 5.788 s.

The first broader ID/include/query/temporal jobs remain red: PostgreSQL regular
**256/294** and MySQL regular **257/294**. The fail-fast runner did not reach
AnyAPI for those four-file commands. Failures include SQLite-specific type/SQL
assertions as well as query and temporal behavior requiring fixes; passing
environment setup is not complete driver conformance. A3-02 through A3-06 and
CI remain open. Verified total: **44/214 (20.6%)**, A37/138, B5/48, M2/14, C0/14.

The separate include-limit follow-up passes **75/75** on both storage modes of
both real servers (300 checks): PostgreSQL 19.635/28.080 s and MySQL
23.797/33.119 s, logs `/tmp/library-database-{pg,mysql}-include-limits.log`.
This strengthens the previous include fix's evidence without closing the wider
driver/query/temporal checklist items.

### 2026-09-09: real-driver query and ID contracts; A3-04 complete

PostgreSQL DISTINCT queries rejected the previous null-ordering expression.
The existing sort helpers now use PostgreSQL's native null ordering and the
already-selected projection alias, which also avoids treating separately bound
copies of one expression as different DISTINCT sort keys. Regular and AnyAPI
storage share the column-order helper; SQLite/MySQL retain their value ordering.

The shared query fixture now authors valid MySQL concatenation SQL, and physical
type assertions name each driver's actual types. LIKE expectations explicitly
follow the fixture's database collation; no case-folding layer was added.
Six new generated-ID cases separate server allocation from explicit seed IDs
and cover mapped keys, all write returns, both formats and persisted relationships.
Four new DISTINCT projection cases cover bound expressions, tied/null keys,
sparse fields, counts and complete forward/backward traversal. The migration
guide explains PostgreSQL sequence synchronization after explicit seed/import IDs.

The focused ID/query suites pass **165 regular / 163 AnyAPI** checks on each
database. The default database command now includes environment, ID, query and
include-limit suites: **244 regular / 242 AnyAPI** on SQLite, PostgreSQL 16.15
and MySQL 8.0.46, **1,458 checks** total with no failures/skips, exit 0. Both
server PIDs stopped and the disposable directory was removed.

All test stages of `npm run verify` passed: **1840/1841 regular** (one existing
skip), **1836/1836 AnyAPI**, **328/328 Express 4** per mode. The command then
stopped at two runner-formatting lint errors; those were corrected and the
separate lint command passed. See [verification evidence](docs/development/verification-progress.md)
for exact logs and the documentation closeout.

A3-03's temporal failures, schema/introspection, concurrency, full database
coverage and CI remain open. Consumer repositories and seeds remain untouched;
the parked migration is unchanged. Verified total: **45/214 (21.0%)**,
A38/138, B5/48, M2/14, C0/14.

### 2026-09-09: real-driver temporal contracts; A3-03 complete

The temporal suite now executes 101 regular-storage cases on each of SQLite,
PostgreSQL 16.15 and MySQL 8.0.46, with 102 SQLite AnyAPI / 103 native AnyAPI
cases including migration guards. Actual driver inspection exposed timezone
shifts, lost fractional digits, incompatible calendar/time slots and MySQL's
default timestamp rounding. Existing normalization and storage helpers now bind
UTC values explicitly, preserve driver temporal strings per read, normalize
equivalent time spellings consistently, and use precision 6 for new native
timestamp/time columns unless the schema declares another precision. MySQL's
native year range and SQL time precision limits reject unsupported writes before
commit, including none/minimal returns. AnyAPI uses text slots for calendar
dates and times; existing incompatible metadata/columns require migration.

Review after the first green full gate and database matrix found two additional
defects: an AnyAPI projected date cursor repeated its current row, and precise
timestamp projections ignored the existing custom storage serializer. A focused
reproduction failed three of four checks before correction. Query projection
predicates now reuse the existing field serializer and canonical text-storage
choice. Six permanent cases cover complete forward/backward traversal, ties,
nulls, sparse selection and serializer metadata in both response formats.

Final `npm run verify` exits 0: **1877/1878 regular** (one existing skip),
**1874/1874 AnyAPI**, **328/328 Express 4 per mode**, lint and docs. The expanded
five-suite database matrix exits 0 with **2,069 passing checks**, no skips:
SQLite **345 regular / 344 AnyAPI**, PostgreSQL and MySQL **345/345 per mode**.
The temporary servers stopped and their directory was removed. Exact logs,
durations and before/after evidence are in
[verification progress](docs/development/verification-progress.md).

The [migration guide](docs/GUIDE/MIGRATING_API_V2.md) describes public temporal
shapes, serializer use, native storage limits and preservation of existing
AnyAPI data. Existing-data migration execution, full schema/introspection,
concurrency, complete driver coverage and CI remain open under A3-05, A3-06,
A3-02, A2-16 and A3-12. Consumer repositories and seeds remain untouched; the
parked patch checksum is unchanged. Verified total: **46/214 (21.5%)**,
A39/138, B5/48, M2/14, C0/14.

### 2026-09-09: real table introspection and migrations; A3-05 in progress

Added ordinary-table schema tests on SQLite, PostgreSQL 16.15 and MySQL 8.0.46.
They execute direct/generated creation, mapped columns and types, static and
function defaults, additive/precision migrations with existing rows, named
foreign-key replacement, enum/default changes, failed narrowing and empty
second diffs. They use the actual requested database but remain regular-table
tests even during the AnyAPI invocation; canonical migration coverage is still
required separately.

The existing helpers now support PostgreSQL introspection, compare effective
column/default metadata, preserve BigInt defaults in executable code, detect
temporal precision changes, declare PostgreSQL time precision explicitly, and
drop changed foreign keys before replacement. Review caught enum alterations
after an initial green full gate and 2,147-check matrix. PostgreSQL now replaces
its inline enum check separately; SQLite reports the required table rebuild
instead of silently keeping an obsolete restriction while claiming to alter it.
Changing only an enum default works on all three databases. The diff result's
new `dropCheckConstraints` list is documented in the API migration guide.

Simplicity decision: retain a schema diff built from ordinary functions.
SQLite's unsupported enum-value alteration is explicit; this batch does not
introduce a SQLite DDL parser/rebuilder or a migration-history framework.
The permanent focused suite passes **15 SQLite / 18 PostgreSQL / 17 MySQL**
cases per invocation. Detailed before/after and full-gate evidence is in
[verification progress](docs/development/verification-progress.md).

Final `npm run verify` exits 0: **1892/1893 regular** (one existing skip),
**1889/1889 AnyAPI**, **328/328 Express 4 per mode**, lint and docs. The expanded
six-suite database matrix passes **2,169 checks** without failures or skips:
SQLite **360 regular / 359 AnyAPI**, PostgreSQL **363 per mode**, MySQL
**362 per mode**. Temporary database servers and their directory were cleaned up.

A3-05 stays open for canonical existing-data migration, additional schema
dependencies and public/default paths. Consumer repositories and seeds remain
untouched, and the parked patch checksum is unchanged. No additional checklist
item is claimed: **46/214 complete (21.5%)**, A39/138, B5/48, M2/14, C0/14.

### 2026-09-09: existing AnyAPI temporal data migration and startup guard

The migration guide now includes an executable one-off example for moving old
calendar/time values into explicitly selected string slots, with converter
functions chosen for the original storage convention. It preserves old slots,
IDs, tenant/resource boundaries, relationships and unrelated metadata. Data
copying uses the caller's transaction; native precision DDL remains a separate
documented step with explicit column-modifier assumptions.

Twenty permanent cases pass on SQLite, PostgreSQL and MySQL in both runner
invocations. They verify exact snapshots, fresh API reads, both formats, filters,
cursor traversal, existing microseconds, three batches, null/soft-deleted records,
empty resources, rejected mappings/conversions and caller rollback. The suite
always uses canonical storage; repeated invocation is not regular-table evidence.

Review reproduced a startup bypass: resource registration replaced old field
metadata before the temporal migration guard could inspect it. Registration now
loads and validates the persisted descriptor before replacing metadata, reusing
the existing loader. Direct registration with owned/borrowed transactions and
fresh startup are covered by regressions that failed before the fix.

The default database command now includes seven suites. Exact gate/matrix results
and the deliberately interrupted pre-fix runs are recorded in
[verification progress](docs/development/verification-progress.md). A3-05 stays
open for broader schema dependencies and public/default helper paths. Consumer
repositories and seeds remain untouched. **46/214 complete (21.5%)**,
A39/138, B5/48, M2/14, C0/14.

The next public-helper probe reproduces `AnyAPI.addKnexFields` throwing while
mutating scope options, before it allocates the new field. This remains unfixed
at this batch's closeout and is the next A3-05 task. Its evidence and remaining
public/default/dependency checks are recorded in the verification log.

Final `npm run verify` exits 0: **1912/1913 regular** (one existing skip),
**1909/1909 AnyAPI**, **328/328 Express 4 per mode**, lint and docs. The seven-suite
database matrix passes **2,289 checks**, no failures/skips: SQLite **380/379**,
PostgreSQL **383/383**, MySQL **382/382**. The server directory and its processes
were cleaned up. The package dry-run includes the migration example and its
documented helper imports; consumer migration remains on hold.

### 2026-09-09: canonical field additions and descriptor transactions

Fixed the previously reproduced AnyAPI `addKnexFields` failure. The helper now
uses the existing options registry and schema compiler, persists field definitions
with their allocations, refreshes getters/setters/defaults/serializers and request
contracts, and groups each addition batch in one metadata transaction. The runtime
schema is published after successful commit. Ineffective proxy-property access
and partial hand-built descriptor updates were removed.

Related regressions cover explicit maps taking effect during registration,
repeated `createKnexTable` preserving dynamically added fields, stored schema
surviving cache reload, borrowed transaction reads and cache isolation, invalid
slot indices/spellings, and computed/virtual definitions without storage slots.
The API migration guide documents callback redeclaration on restart and explicit
cache invalidation after deep registry callers commit borrowed transactions.

The **13 new cases** pass on SQLite, PostgreSQL and MySQL in both runner
invocations. Together with the temporal migration/conformance files, selected
runs pass **134/135 SQLite**, **134/136 PostgreSQL**, and **134/136 MySQL**, without
failures or skips. The new suite always uses canonical storage; its regular
invocation is not regular-table DDL coverage. The default database matrix now
contains eight suites; exact final results are in
[verification progress](docs/development/verification-progress.md).

A3-05 remains open for native regular public helper wiring/direct alterations
and composite foreign-key/index dependencies. No additional checklist item is
claimed: **46/214 complete (21.5%)**, A39/138, B5/48, M2/14, C0/14. Consumer
repositories and seeds remain on hold and untouched.

Final `npm run verify` passes: **1925/1926 regular** (one existing skip),
**1922/1922 AnyAPI**, **328/328 Express 4 per mode**, lint and docs. The eight-suite
database matrix passes **2,367 checks**, no failures/skips: SQLite **393/392**,
PostgreSQL **396/396**, MySQL **395/395**. Temporary servers and their directory
were cleaned up. The parked consumer patch is unchanged.

### 2026-09-09: public table helpers and composite dependencies

Regular public additions/alterations now pass through resource-level
`storage.naming`; exact-naming resources previously added a wrong snake-case
column or silently failed to change the intended SQLite column default. Custom
IDs and computed-field exclusion already worked and required no runtime change.
MySQL diffs now drop and restore a dependent foreign key when replacing or
removing its supporting index. Existing diff steps are reused, with no duplicate
key operations when its definition is changing as well.

Added **13 permanent real-table cases**: eight public-helper cases for both
naming settings, physical IDs, mappings, defaults, non-stored fields and
direct/generated creation; five composite cases for index/key replacement,
uniqueness removal and dependency-aware column drops. Tests check data and
referential enforcement, including cross-pair rejection and cascading actions.
The guides document the naming change, data inspection, and MySQL's
multi-statement DDL/implicit-commit requirements.

The full gate's test stages pass **1938/1939 regular** (one existing skip),
**1935/1935 AnyAPI**, and **328/328 Express 4 per mode**. The initial command
stopped on two new-test formatting errors; those were corrected and full lint
then passed. The eight-suite native matrix passes **2,445 checks**: SQLite
**406/405**, PostgreSQL **409/409**, MySQL **408/408**, no failures/skips.
Fixed-backend suite repetitions do not claim coverage of the other backend.
Exact commands, durations and cleanup are in
[verification progress](docs/development/verification-progress.md).

A separate public direct-enum probe still fails: **1/3 SQLite**, **0/3
PostgreSQL**, **3/3 MySQL per invocation**. PostgreSQL generates invalid ALTER
syntax; SQLite and PostgreSQL retain obsolete checks in other direct changes.
Direct enum handling and failure atomicity are next, so **A3-05 remains open**.
Verified total remains **46/214 (21.5%)**, A39/138, B5/48, M2/14, C0/14. Consumer
repositories and seeds remain untouched; the parked migration patch is unchanged.
The final documentation build and `git diff --check` pass.

### 2026-09-09: direct alterations and schema literals; A3-05 complete

Direct PostgreSQL enum alterations now share enum planning with generated
migrations and preserve transaction ownership/rollback. SQLite changes requiring
an enum-check replacement reject before the field batch starts; ordinary rebuilds
reuse Knex's transaction and foreign-key handling. MySQL borrowed DDL transactions
and unsafe borrowed SQLite rebuilds are rejected before side effects. Existing
introspection readers were reused without imposing full snapshot ID/index
restrictions on field alterations.

Further regressions fixed escaped enum/default literals, JSON/array SQL defaults,
PostgreSQL literal question marks and quoted/case-sensitive constraint identifiers,
and MySQL enum/SET and generated-JSON-default introspection. A review caught and
removed an unnecessary SQLite wrapper that could cascade child deletions. Native
tests verify preserved values/constraints and owner rollback, including failed
field batches, opaque IDs, unusual/qualified names and unrelated partial indexes.
The migration guide documents changed failures and standalone dialect requirements.

The final gate passes **1957/1958 regular** (one existing skip), **1954/1954
AnyAPI**, **328/328 Express 4 per mode**, lint and docs. The nine-suite database
matrix passes **2,567 checks**, no failures/skips: SQLite **425/424**, PostgreSQL
**432/432**, MySQL **427/427**. Fixed-storage suite repetitions retain their
documented limits. Temporary database directories and servers were cleaned up.

[Verification evidence](docs/development/verification-progress.md) maps A3-05's
creation, introspection, executable migrations, static/function defaults and
storage mappings to actual driver checks, including the preceding canonical
existing-data and field-evolution batches. **A3-05 is complete**. A3-06's concurrent
transactions/isolation, complete driver coverage/CI, broader metadata and the final
reviews remain open. Consumer repositories and seeds remain untouched; the parked
patch is unchanged.

Verified total: **47/214 (22.0%)**, A40/138, B5/48, M2/14, C0/14; **167 remain**.

### 2026-09-09: separate-connection transactions; A3-06 continues

Added twelve permanent application-transaction cases using real independent
connections, plus the existing sixteen reused-context cases in the native matrix.
SQLite concurrency fixtures use disposable WAL files and immediate busy errors;
native fixtures use their existing separate pooled connections. Tests exercise
uncommitted visibility, included/related reads in borrowed transactions,
commit/rollback across reverse and many-to-many relationships, a later-child
failure, repeatable snapshots, overlapping disjoint PATCH writes, atomic bulk
visibility/rollback, and concurrent generated identities. An explicit free ID
keeps PostgreSQL sequence state from masking the reused-context POST failure.
No runtime transaction implementation was changed in this batch.

The focused transaction matrix passes **168 checks** across both storage modes
and all three drivers. Full `npm run verify` passes **1969/1970 regular** (one
existing skip), **1966/1966 AnyAPI**, **328/328 Express 4 per mode**, lint and docs.
The expanded eleven-suite database matrix passes **2,735 checks**, no failures or
skips: SQLite **453/452**, PostgreSQL **460/460**, MySQL **455/455**. Exact logs,
durations, cleanup and fixed-storage suite limits are in
[verification evidence](docs/development/verification-progress.md).

**A3-06 remains open** for competing relationship replacements, lock/deadlock
outcomes and further integrity races. A7/B2 outcome, bulk borrowing and deferred
notification requirements also remain open. The consumer repositories and seeds
remain on hold; the parked patch is unchanged. Verified total remains
**47/214 (22.0%)**, A40/138, B5/48, M2/14, C0/14; **167 remain**.

### 2026-09-09: concurrent relationship integrity; A3-06 complete

Native regressions reproduced merged relationship replacements, hasOne writes
leaving two children, duplicate pivot edges, duplicates through inverse endpoints,
and ordinary/polymorphic references attached after their target was deleted.
Parent locking now advances a scoped row version, target locking rechecks existing
references, and membership reads use database locks. Existing storage adapters,
relationship processing and canonical link loading are reused; no transaction
framework, conversion copy or automatic retry was introduced. The ID fixture's
canonical link mapping now participates in existing cleanup.

The permanent transaction suite has **32 SQLite / 33 PostgreSQL / 33 MySQL** cases.
Together with sixteen reused-context cases, its focused matrix passes **292
checks**. Actual connections, private writes, commit/rollback, repeatable
snapshots, competing replacements, inverse additions, target/parent deletion,
generated IDs, atomic batches, native deadlocks and winner-only recovery are
verified. The migration guide explains UPDATE-trigger effects, database grants,
owner rollback/retry and reconciliation of existing duplicate edges.

Full `npm run verify` passes **1989/1990 regular** (one existing skip),
**1986/1986 AnyAPI**, **328/328 Express 4 per mode**, lint and docs. The eleven-suite
native matrix passes **2,859 checks**, no failures/skips: SQLite **473/472**,
PostgreSQL **481/481**, MySQL **476/476**. Temporary server directories and
processes were cleaned up. The [acceptance record](docs/development/verification-progress.md)
maps A3-06's requirements to tests and records reproduction, review, limits and
exact logs.

**A3-06 is complete.** Full driver coverage, required CI integration jobs,
transaction outcomes/cleanup/bulk borrowing/deferred notifications, and the final
reviews remain open. Consumer repositories and seeds remain on hold; the parked
patch is unchanged. Verified total: **48/214 (22.4%)**, A41/138, B5/48, M2/14,
C0/14; **166 remain**.

### 2026-09-09: expanded driver coverage and required CI jobs

The default native runner now discovers every shared conformance file, including
formerly SQLite-only bulk authorization, reverse writes and Socket.IO policies.
The expansion reproduced a PostgreSQL numeric-reference LIKE failure. The
existing operator helper now casts text-search columns appropriately; equality,
range and ordering retain their type/collation. Native collation fixtures keep
the original assertions, and a driver mismatch now fails fixture setup.
The migration guide documents the correction without adding a compatibility path.

All **24 default files** pass on actual SQLite 3.49.2, PostgreSQL 16.15 and MySQL
8.0.46, in both storage modes, on Node 22.16.0 and 24.6.0: **6,849 checks per
runtime**, no failures/cancellations/skips. Both full verification gates pass
**1996/1997 regular** (one existing skip), **1993/1993 AnyAPI**, **328/328 Express 4
per mode**, lint and docs. Node 24 used a private copy with fresh native
dependencies; tested runtime/test/package source was reconciled against this
workspace. Seven runner-failure cases pass for each database on both runtimes.

The new [CI workflow](.github/workflows/verify.yml) runs two full-library jobs
and four native jobs, with disposable servers and explicit readiness. Missing
servers, test files, dependencies or the requested fixture driver fail. Its
final check requires every matrix entry to succeed. Workflow lint passes and
all sixteen success/failure/cancelled/skipped aggregate-result combinations were
checked. All underlying job commands have run locally; no remote GitHub run or
branch-protection change is claimed.

**A3-02, A1-08 and A3-12 are complete.** The
[acceptance record](docs/development/verification-progress.md) contains exact
results, source reconciliation, cleanup and limits; the
[coverage guide](docs/development/conformance.md#expanded-database-coverage)
maps shared behavior to executed files. A2-16's complete capability audit,
later lifecycle/API work and the three final reviews remain open. Consumer
repositories and seeds remain on hold and the parked migration patch is
unchanged. Verified total: **51/214 (23.8%)**, A44/138, B5/48, M2/14, C0/14;
**163 remain**.

### 2026-09-09: capability audit — labels, Redis and sparse fieldsets

The audit found and fixed generated-label privacy, authored-label preservation,
alias/null/ID fallback and computed/virtual visibility defects. Labels, values
and temporal behavior pass 995 checks across all six SQL/storage combinations
on Node 22. Computed callbacks now receive the current resource's logical ID;
explicit dependencies replace the old normally-hidden compatibility fallback.

The existing runner now verifies actual Redis Pub/Sub between two Socket.IO
servers. Node 22 and 24 each pass 36 notification cases and eight runner-failure
cases. Redis is in the required CI matrix; production startup/reconnect/shutdown
behavior remains open.

The label audit also exposed incorrect sparse-fieldset behavior. A new 64-case
suite failed completely against the pre-fix runtime. Fieldsets now accept
declared relationship names, omit unrequested relationships, preserve empty
fieldsets and restrict included resource types. The existing relationship
resolver was moved and reused; no duplicate resolver or compatibility shim was
added. All 384 fieldset cases pass on Node 24 across the six SQL/storage
combinations. Eighteen HTTP cases per storage mode and updated migration
examples cover the caller-visible contract. Final full gates pass on Node 22
and 24: **2129/2130 regular** (one existing skip), **2126/2126 canonical**,
**337/337 Express 4 per mode**, lint and docs. The expanded five-suite Node 22
native matrix passes **1,728 checks**. Both runtimes pass their 36 Redis cases
again on the final source. Test/runtime/package/CI sources matched across 209
files before the temporary Node 24 copy was removed.

The [evidence log](docs/development/verification-progress.md) records failures,
fixes, exact commands/results and remaining boundaries. **A2-16 stays open.**
Verified total remains **51/214 (23.8%)**, A44/138, B5/48, M2/14, C0/14;
**163 remain**. Consumer repositories and seeds remain untouched, and the parked
migration patch checksum is unchanged.

### 2026-09-09: capability audit — Redis lifecycle and connection loss

The next audit batch reproduced and fixed partial Socket.IO state after failed
Redis startup, leaked clients at shutdown, failed-start authentication overrides
surviving retries and overlapping/duplicate starts. The existing start/close API
now has explicit ownership and cleanup, documented in the migration guide.
Sixteen lifecycle cases plus 52 notification/reconnection cases execute against
real Redis per runtime. Node 22 and 24 each pass all 68, the eight runner
failure/interruption cases and their full verification gate: 2129/2130 regular
(one existing skip), 2126/2126 canonical, 337/337 Express 4 per mode, lint and
docs. Native Socket.IO authorization passes 360 checks on Node 22 across all
SQL/storage combinations. The 212 selected runtime/test/script/package/CI files
match between the tested source copies.

The [evidence log](docs/development/verification-progress.md) records the failures,
fixes and exact results. The capability map now includes both documented deep
imports, BulkOperationsPlugin and PositioningPlugin. Positioning's existing four
suites explicitly use SQLite; PostgreSQL/MySQL coverage is the next audit gap.
**A2-16 stays open; 51/214 (23.8%) are complete and 163 remain.** Consumer
repositories and seeds remain on hold, and the parked migration patch is unchanged.

### 2026-09-09: positioning probe paused

The four historical positioning suites now obtain their database from the
existing disposable fixture instead of hardcoding SQLite. PostgreSQL and MySQL
regular-storage runs each passed **55/60**, with five duplicate-position failures
under simultaneous inserts/moves (`/tmp/library-positioning-postgres-before.log`
and `/tmp/library-positioning-mysql-before.log`). Each runner stopped after its
failed regular run; canonical positioning on these drivers remains unexecuted.
No runtime fix or new default runner entry was added. The maintainer then asked
to leave positioning for now, so this work is paused and A2-16 remains open.

Read-only searches of the current jskit-ai source found no PositioningPlugin,
fractional-positioning or beforeId usage. Its json-rest-api host installs core,
Knex, AutoFilter, RowPolicy and QueryProjections. Its `packages/realtime` imports
Socket.IO directly, independently of this library's SocketIOPlugin. No jskit-ai,
vibe64 or seed source was changed. The verified count remains **51/214**.


### 2026-09-09: core write traces and small helper simplifications

The [selected lifecycle contract](docs/development/write-lifecycle.md) documents
resource hook order, nested GETs, context and transaction ownership, existing
plugin consumers and the comparison made before each change. The new shared
suite passes 271 cases per SQL/storage combination before and after the changes:
52 successful traces and 219 separately injected hook/setter/typed-getter failures.
The pre-change native baseline passed all 1,626 checks.

POST, PATCH and PUT now pass their write context to the existing setter helper.
The existing response helper runs finish hooks and normalization once after
response selection; unused arguments and a dead DELETE branch were removed.
The changes remove 105 lines across the three resource methods and `common.js`,
without a new runtime helper or dispatch layer. Public resource calls, hook
names/order and setter callback arguments retain their tested behavior. The
migration guide documents the changed internal setter-helper signature; no
current jskit-ai caller imports it.

Final full gates pass on Node 22.16.0 and 24.6.0: **2400/2401 regular** (one
existing skip), **2397/2397 canonical**, **337/337 Express 4 per mode**, lint and
docs. Each runtime also passes **2,466 native checks**, 411 in each SQL/storage
combination, covering lifecycle, response formats, reused transaction context
and fieldsets. The [evidence log](docs/development/verification-progress.md)
records commands, logs, durations and limitations. The 213 selected source files
matched across both tested copies before the temporary Node 24 copy was removed.

**A4-02, A4-06, A4-07 and A4-15 are complete.** The broader lifecycle contract,
relationship/bulk traces, generated-ID hook timing, secondary failure handling,
consumer-dependent acceptance and final reviews remain open. A2-16 remains open
and positioning stays paused. Consumer repositories and seeds remain unchanged;
the parked migration patch checksum is unchanged. Verified total: **55/214
(25.7%)**, A48/138, B5/48, M2/14, C0/14; **159 remain**.


### 2026-09-09: write response completion and method review

The final response review reproduced finish hooks reintroducing excluded fields,
after-commit hooks mutating already-normalized output, and stale IDs in early
hooks when POST/PUT/PATCH reused a context. Existing normalization/fieldset
helpers now enforce the selected fields after write finish hooks. The existing
response helper copies minimal/full output before commit, separating it from
later observer mutations. Common request setup clears the previous ID; each
method still assigns its current ID at its established boundary. No second
normalizer, serializer or operation engine was added.

The lifecycle suite grows to **368 cases per mode**. Fieldsets gain 36 cases and
temporal response boundaries gain 36 cases. Explicit regressions cover owned and
borrowed transactions, generated IDs, reused contexts, minimal identifiers,
primary/included output and copy failures before commit. Full gates pass on
Node 22.16.0 and 24.6.0: **2569/2570 regular** (one existing skip), **2566/2566
canonical**, **337/337 Express 4 per mode**, lint and docs. Both runtimes pass
**4,427 native checks** across SQLite, PostgreSQL and MySQL with both storage
modes. Exact reproduction/final logs are in the
[evidence record](docs/development/verification-progress.md).

The [method review](docs/development/write-lifecycle.md) confirms that PATCH
keeps partial validation, existence/authorization checks and relationship
choices explicit. DELETE and relationship methods already share the useful
validation/completion helpers; they do not need resource setters or response
preparation. Keep their distinct sequences. The resulting methods retain simple
call sites without extra mode flags or callbacks. **A4-09, A4-11 and A4-17 are
complete.** The [migration guide](docs/GUIDE/MIGRATING_API_V2.md#write-hooks-and-the-returned-response)
and hook reference explain the selected response boundary and ID timing.

A4-13 remains open for its broader normalization/consumer requirements.
Relationship/bulk traces, secondary cleanup failures, managed transactions and
final reviews remain unfinished. Positioning, jskit-ai, vibe64 and seeds remain
paused and unchanged. Verified total: **58/214 (27.1%)**, A51/138, B5/48, M2/14,
C0/14; **156 remain**.

### 2026-09-09: Node 24 policy and write cleanup failures

The maintainer's revised policy is implemented: Node 24+ is required and only
Node 24 is tested. Package engines, `.nvmrc`, CI and setup/migration guides agree.
CI retains all database/storage/Redis coverage with four jobs instead of eight;
actionlint passes. The root clean install now uses Node 24.6.0, with unchanged
non-root locked dependency entries. Older runtime results remain historical.

The shared write error handler now preserves the original rejection when
rollback, afterRollback or logging also fails. Ordered secondary failures are
available through the operation context and are cleared on reuse. Rollback hooks
run only after acknowledged rollback, and async logging is awaited. All 18
helper regressions failed before the change and now pass. Forty-eight shared
resource/relationship cases per database/storage combination cover actual writes,
ownership, secondary failures, recovery and reuse.

The full Node 24 gate passes **2635/2636 regular** (one existing skip),
**2632/2632 canonical**, **337/337 Express 4 per mode**, lint and docs. The
four-suite native matrix passes **2,844 checks**, 474 in every SQL/storage
combination. The [evidence log](docs/development/verification-progress.md)
records exact commands, results and scope. **A7-05 remains open** for bulk and
other failure boundaries; transaction outcomes and final reviews are unfinished.
The checklist remains **58/214 (27.1%); 156 remain**. Positioning, jskit-ai,
vibe64 and seeds remain on hold; the parked migration patch is unchanged.

### 2026-09-09: atomic bulk rollback and failure-boundary review

Atomic POST/PATCH/DELETE could lose the original child error and attempt
rollback twice when cleanup rejected. Commit errors and malformed PATCH errors
could also be replaced. The outer bulk catch now owns rollback; resource and
bulk handlers share the existing rollback-diagnostic sequence through
`lib/error-context.js`. The methods retain their own transaction selection and
completion-hook behavior. Bulk context diagnostics clear on reuse.

Twenty shared bulk regressions cover actual writes and relationships, child/
validation/commit failures, rejected rollback, completed transactions and
context reuse. They failed before the change and pass afterward. The focused
resource/relationship/helper/bulk run passes **86/86**. The full Node 24 gate
passes **2655/2656 regular** (one existing skip), **2652/2652 canonical**,
**337/337 Express 4 per mode**, lint and docs; the five-suite native matrix
passes **3,048 checks** across all SQL/storage combinations.

The [evidence log](docs/development/verification-progress.md) and
[remaining failure boundaries](docs/development/write-lifecycle.md#remaining-error-boundaries)
record the next work. A direct probe confirms null/undefined cause loss in the
include error wrapper; other logging, file-cleanup and dependency boundaries
still require public-path reproduction and fixes. **A7-05/A7-06 remain open.**
The checklist remains **58/214 (27.1%); 156 remain**. Node 24 remains the only
test runtime. Positioning and consumer work remain paused and untouched.

### 2026-09-09: include/projection failures preserve causes

Public GET/query/full-PATCH regressions reproduced null/undefined cause loss
through every relationship include kind. Lower-level cases also reproduced
throwing error loggers masking the original failure and unhandled rejected
logging promises. The existing error wrapper now handles non-Error values;
query-projection callbacks add field/resource context at the shared boundary.
Nested include catches preserve contextual causes without duplicate error logs.
Typed API errors retain identity. No compatibility mode or error framework was
introduced.

Final focused coverage passes **164/164**, including 100 shared public-path
cases, nested projections, recovery reads and owned/borrowed write-response
failures. The full Node 24 gate passes **2819/2820 regular** (one existing skip),
**2816/2816 canonical**, **337/337 Express 4 per mode**, lint and docs. The
five-suite native matrix passes **2,556 checks** across all SQL/storage
combinations. The [evidence log](docs/development/verification-progress.md)
records the corrected pre-fix tests, commands, source hashes and limitations.

Independent public probes confirm two remaining defects: query-copy error
logging can replace `DataCloneError`, and the installed hook dispatcher loses
a hook's null rejection. These and the remaining cleanup/extension boundaries
keep **A7-05/A7-06 open**. The checklist remains **58/214 (27.1%); 156 remain**.
The migration guide is updated. Only Node 24 was tested; positioning and
consumer repositories/seeds remain paused and untouched.

### 2026-09-09: query copy failures and transaction-scoped file cleanup

Query/getRelated copy failures now propagate without a redundant error log that
could replace them. Filesystem tests reproduced lost cleanup diagnostics,
warning failures stopping later cleanup, lost failed-deletion tracking and
context reuse deleting files from an earlier committed write. Cleanup now keeps
diagnostics, attempts later files and tracks each upload by its transaction.
Unexpected detector/parser/storage errors retain causes; real HTTP tests
distinguish storage failure (500), access denial (403) and invalid MIME (422).

The final review then reproduced a commit wrapper rejecting after actual
completion, followed by rollback cleanup deleting the committed file. All ten
new resource/relationship/file cases failed before the shared completion guard.
Resource and bulk handlers now use that guard and retain earlier diagnostics;
completed transactions never trigger rollback hooks. Outcome metadata remains
separate unfinished work.

Final focused coverage passes **165/165**. The full Node 24 gate passes
**2891/2892 regular** (one existing skip), **2888/2888 canonical**, **337/337
Express 4 per mode**, lint and docs. The six-suite native matrix passes
**3,144 checks**, 524 in every SQL/storage combination. The
[evidence log](docs/development/verification-progress.md) records reproduction,
intermediate/final runs, source hashes and remaining boundaries.

A direct AnyAPI registry probe confirms another rollback catch can replace an
allocation error; that is the next failure boundary to fix. The hook dispatcher,
managed/borrowed/atomic-bulk side effects, previous-file replacement/deletion
and final reviews remain open. **58/214 (27.1%) are complete; 156 remain.**
The migration guide is updated. Only Node 24 was tested; consumer repositories,
seeds and positioning remain paused and untouched.

### 2026-09-09: registry failure handling and descriptor cache keys

New/existing canonical registration and field allocation now retain their
original rejection when rollback fails. Their owned failure handling reuses
the shared completion guard, invalidates potentially stale descriptors and
guards diagnostic logging. The initial regression matrix failed **27/48**;
it includes commit rejection after database completion, borrowed ownership,
non-Error/frozen rejections, metadata state and recovery after rollback.

A separate regression exposed tenant/resource pairs colliding in the descriptor
cache. The existing key helper now encodes the complete pair unambiguously;
isolated reads, updates and invalidation pass without a data migration. The
registry suite contains **49 cases** and is included in the native runner.

Node 24 full test stages pass **2940/2941 regular** (one existing skip),
**2937/2937 canonical** and **337/337 Express 4 per mode**. Native targeted
verification passes **1,384 checks**. The verification command stopped at test
formatting lint errors; after whitespace-only corrections, final lint and
**98/98** focused checks pass. Runtime source is unchanged from the full/native
runs. The [evidence log](docs/development/verification-progress.md) records exact
commands/results, source hashes, migration notes and the separate docs rebuild.

An additional public GET probe confirms canonical descriptor failures can be
swallowed and omit relationships. Those read/inverse-link catches are next;
hook dispatch, managed side effects, outcome metadata and full final review
remain open. **58/214 (27.1%) are complete; 156 remain.** Consumer repositories,
seeds and positioning remain paused and untouched.

### 2026-09-09: descriptor reads and post-write refresh failures

Canonical descriptor reads now retain unexpected causes and tenant/resource
context. Four broad relationship catches that could silently omit linkage or
includes were removed. Direct registry lookups still return null for absent
metadata; required relationship descriptors reject when missing.

Tracing every descriptor read also reproduced the shared write-return helper
swallowing a failed minimal-record refresh. POST/PUT/PATCH now reject that
failure before finish/owned commit, preserving causes and `postWriteRead`
context. No new error-policy switch or compatibility layer was introduced.

New coverage comprises **65 canonical cases** (including 420 programmatic/direct
descriptor failure injections and 24 real HTTP cases) and **48 shared refresh
cases** covering modes, ownership, rows/pivots and recovery. Express 4 commands
include the new Express cases. Final focused checks pass **162/162**. Node 24
`npm run verify` completes with **3053/3054 regular** (one existing skip),
**3050/3050 canonical**, **349/349 Express 4 per mode**, lint and docs. The native
matrix passes **4,032 checks**, 672 per SQL/storage combination. The
[evidence log](docs/development/verification-progress.md) records baseline
failures, corrected test fixtures, exact commands/results and source hashes.

Migration guidance explains the former partial-success behavior and the new
rejections. Setter causes, getter/computed fallbacks, ordinary pivot validation,
hook dispatch and broader transaction outcomes remain open. **58/214 (27.1%)
are complete; 156 remain.** Consumer repositories, seeds and positioning remain
paused and untouched.


### 2026-09-09: field callback errors and related-target classification

Setters, getters and computed fields now use the existing error wrapper.
Unexpected setter failures retain their cause and remain server errors;
intentional validation errors retain 422. Getter/computed failures reject
instead of returning the original value/null. Ordinary many-to-many validation
no longer replaces every related GET failure with 404. No policy option,
compatibility layer or new error framework is introduced.

The 220 new shared regressions initially passed **76**, failing **144**. They
now pass in both storage modes, covering primary/nested/all include kinds,
formats, synchronous/asynchronous errors, response selection, owned/borrowed
writes, pivots and actual HTTP. Existing fallback tests were migrated to
rejection/rollback expectations, with declarations moved into their fixtures.
Focused results are **270/270 per storage mode**.

On Node 24.6.0, `npm run verify` completes successfully: **3273/3274 regular**
(one existing skip), **3270/3270 canonical**, **361/361 Express 4 per mode**,
lint and docs. The targeted SQLite/PostgreSQL/MySQL matrix passes **418 per
storage/database combination, 2,508 total**, without skips or failures.
The [evidence log](docs/development/verification-progress.md) records exact
commands, results, fixture corrections, source hashes and remaining limits.

The [callback/include inventory](docs/development/write-lifecycle.md#b4-callbackinclude-policy-inventory)
distinguishes intentional absence, client errors, denied access, cleanup and
remaining defensive metadata fallbacks. The API guide documents the breaking
error behavior and migration examples. This completes **B4-01, B4-04, B4-06 and
B4-08**. B4-02/B4-07 still require consumer migration; B4-03 retains the metadata
fallback review, and B4-05 remains tied to broader transaction/side-effect work.
The installed hook-dispatch dependency defect and A7/final review stay open.

**62/214 (29.0%) are complete; 152 remain.** Consumer repositories, seeds and
positioning remain paused. The parked jskit-ai patch and dependency entries are
unchanged. All verification used Node 24; none used Node 22 or Node 26.


### 2026-09-09: stored linkage and schema metadata errors

Real stored-row probes showed ordinary includes silently dropping undeclared
polymorphic target types while canonical storage could include a registered
but undeclared target. Five linkage-building/validation callers now reuse a
small function in the existing relationship-contract module. Reads reject
inconsistent stored types with resource/relationship/phase context; submitted
invalid linkage remains a client validation error. Empty relationships and
polymorphic paths supported by only some declared types retain their behavior.

Two empty schema-enumeration catches now preserve unexpected causes. Missing
required scope schema and reverse `via`/canonical field mappings reject instead
of returning empty relationship data. The existing optional relationship-map
fallback remains explicit. Public metadata-read traces and real canonical
configuration mutations verify these boundaries; the registry's descriptor
clones must not be mistaken for mutable stored configuration.

New coverage is **34 shared cases** and **10 helper cases**. Focused checks
including IDs, fieldsets, storage mappings and polymorphic traversal pass
**283/283 per mode**. Node 24.6.0 `npm run verify` passes **3317/3318 regular**
(one existing skip), **3314/3314 canonical**, **363/363 Express 4 per mode**,
lint and docs. The native matrix passes **346 per database/storage combination,
2,076 total**, without failures or skips. The
[evidence log](docs/development/verification-progress.md) records exact scope,
commands, draft-test corrections and unchanged tested-source hashes.

The [migration guide](docs/GUIDE/MIGRATING_API_V2.md#stored-relationship-metadata)
explains repair and error classification. This completes **B4-03** for the
shared getter/computed/include policy. Arbitrary hook dispatch, broader
transaction/cleanup guarantees and consumer migration remain open A7/B4 work;
no Part C final-review item is closed by this batch.

**63/214 (29.4%) are complete; 151 remain.** jskit-ai, vibe64, seeds and
positioning remain paused. No consumer or Node 22/26 verification was run;
the parked patch and dependency entries remain unchanged.

### 2026-09-09: Resource metadata and cache inventory

The [A5 inventory](docs/development/compiled-resources.md) now covers authored
and compiled fields, relationships, IDs, storage mappings, callbacks, query
projections, request/connector schemas, output normalization and their cache
lifetimes. It distinguishes repeated derivations from request-dependent work.
This completes **A5-01**; implementation items A5-02–A5-12 remain open.

Initialization probes confirm two defects: `searchSchema:enrich` receives the
attribute map, and canonical rehydration can overwrite an enriched type while
retaining conflicting storage metadata. Both have recorded reproduction and
regression criteria. Connector refresh, computed dependencies and extension
metadata lifetimes remain risks to test, not additional confirmed failures.

The shared fixture's optional pre-registration hooks pass existing search-merge
checks **5/5 per storage mode** and targeted lint on Node 24. Documentation builds
successfully. Production source remains unchanged from the latest full/native
runs; only the fixture differs among their 225 recorded source hashes. The
[evidence log](docs/development/verification-progress.md) records the commands,
logs and verification limits. Consumer repositories and the parked migration
remain untouched.

**64/214 (29.9%) are complete; 150 remain.** Internal work: **52/138**; API work:
**10/48**; migration: **2/14**; final review: **0/14**. Consumer work and
positioning remain paused. Testing remains Node 24 only.

### 2026-09-09: Enriched schemas, canonical layouts and current HTTP contracts

Search enrichment now receives its own generated filter map, including when
empty, and the compiler uses the hook's final additions/changes/deletions.
Canonical registration allocates from the compiled definitions; descriptor
refresh no longer creates a second validation/search schema that overwrites
hook changes. Field additions and restart retain enriched definitions/callbacks.

A real HTTP regression reproduced Fastify rejecting a newly added relationship
alias while Express/programmatic calls accepted it. Its validator now resolves
the current cached request contract. Existing contract-export tests and real
POST/PUT/PATCH cases establish **A5-05**; authorization and database checks remain
imperative. Other A5 metadata/dependency/configuration criteria stay open.

Canonical re-registration now rejects removal/remapping of occupied field
layouts while records exist. Tests verify preserved rows/metadata on rejection,
empty-resource changes and explicit retained slots. The migration guide explains
enrichment changes, the removed synthetic custom-ID allocation, existing-data
steps and the initialization snapshot used for published route JSON Schema.
The guard does not replace a data migration or coordinate concurrent writers.

Node 24.6.0 `npm run verify` passes **3325/3326 regular** (one existing skip),
**3334/3334 canonical**, **364 regular / 366 canonical Express 4**, lint and docs.
The targeted native matrices pass **2,346 checks** across SQLite/PostgreSQL/MySQL
and both storage invocations. The [evidence log](docs/development/verification-progress.md)
records exact scope, draft-test corrections, the first gate's obsolete slot
assertions, final results and source hashes. All 226 final source hashes match;
the parked patch and dependency entries remain unchanged.

**65/214 (30.4%) are complete; 149 remain.** Internal work: **53/138**; API work:
**10/48**; migration: **2/14**; final review: **0/14**. Consumer repositories,
seeds and positioning remain paused. Testing used Node 24 only.


### 2026-09-09: Computed enrichment and generated-label preservation

LabelPlugin now derives labels during schema compilation after attribute and
search enrichment. Canonical field additions retain labels and rebuild their
source candidates; explicit labels and disabled behavior remain intact.
Computed enrichment is awaited and validated before candidate publication.
Invalid definitions and hook failures leave the existing schema and rows usable.
Supplied non-function computed callbacks, including falsy values previously
silently ignored, now fail registration. The migration guide documents the
computed enrichment boundary and deliberately hook-supplied computed fields.

Node 24.6.0 verification passes **3342/3343 ordinary** (one existing skip),
**3358/3358 canonical**, **364 ordinary / 366 canonical Express 4**, lint and
docs. Targeted schema/label/field-evolution checks pass **585/585** across
SQLite/PostgreSQL/MySQL and both storage invocations. The
[evidence log](docs/development/verification-progress.md#2026-09-09-computed-enrichment-and-label-recompilation)
records the exact scope, pre-fix failures, draft-test corrections and final
source hashes. Dependencies and the parked migration patch remain unchanged.

A5-F5/F6 are resolved; A5-04's dependency execution/selection requirements
remain open. A public probe demonstrates computed-to-computed dependencies
still returning an undefined dependency in both full and sparse reads.
**65/214 (30.4%) are complete; 149 remain.** Consumer repositories, seeds and
positioning remain paused. Testing used Node 24 only.


### 2026-09-09: Dependency compilation and virtual input ownership

Completed **A5-04**. The existing compiler now validates and orders getter,
setter and computed dependencies once. Sparse reads fetch transitive stored
and projected inputs, run prerequisites once and share intermediate computed
results. Visibility is applied after the selected computation. Ordinary fields
without callbacks are valid dependencies; impossible stages, unknown names and
cycles reject configuration. No implicit reads were added to partial setters.

Projection metadata is declared during schema enrichment and published in
`schemaInfo.queryFields`; its runtime consumers use that map directly.
Canonical additions rebuild it and reject namespace collisions before publication.
The unused sorting wrapper was removed. The review also reproduced and fixed
virtual write input leaking onto included records, plus sparse virtual getter
selection. The migration and plugin guides describe these changes.

Node 24.6.0 `npm run verify` passes **3394/3395 ordinary** (one existing skip),
**3411/3411 canonical**, **364 ordinary / 366 canonical Express 4**, lint and
docs. The targeted SQLite/PostgreSQL/MySQL matrix passes **3024/3024** across
both storage invocations. All 219 frozen source hashes match. The
[evidence log](docs/development/verification-progress.md#2026-09-09-compiled-dependencies-projections-and-virtual-input-ownership)
records the exact scope, pre-fix regressions, final results and limitations.

**66/214 (30.8%) are complete; 148 remain.** Internal work: **54/138**; API work:
**10/48**; migration: **2/14**; final review: **0/14**. Consumer repositories,
seeds and positioning remain paused. The parked patch and dependency entries
are unchanged. Broader compiled-metadata ownership, configuration lifetime,
contract reuse and consumer migration remain open.


### 2026-09-09: Cursor contract reuse and storage-operation inventory

Completed **A5-07**. Cursor validation reuses scalar contracts owned by each
compiled resource schema and preserves its type/validator snapshots. Recompilation
gets a fresh cache; descriptor-only refresh keeps valid contracts. Values,
errors and caller context remain local to each validation. Existing temporal
output contract reuse is retained. The migration guide documents handler
registration timing and the internal helper's owning-schema argument.

Ten focused tests cover reuse, incompatible definitions, handler snapshots,
nested validation and separation from temporal output conversion. An isolated
Node 24 benchmark of 10,000 four-field validations fell from a median
**1241.358 ms to 85.768 ms**; this does not measure database/query throughput.

Completed **A6-01** with a source inventory mapping current core callers to
field/value translation, selection, filters, sorting/pagination, scoped reads,
resource/relationship writes and transaction handoff. It records existing
ordinary/canonical owners, adapter lifetimes and concrete follow-up checks.
Broader storage consolidation, proxy usage/migration and typing remain open.

Final Node 24.6.0 `npm run verify` passes **3404/3405 ordinary** (one existing
skip), **3421/3421 canonical**, **364 ordinary / 366 canonical Express 4**,
lint and docs. The targeted native matrix passes **2195 checks**, with three
existing canonical-only fixture checks skipped in ordinary invocations and no
failures. All 221 frozen source hashes match; the parked patch and dependency
entries are unchanged. Exact scope and results are in the
[evidence log](docs/development/verification-progress.md#2026-09-09-cursor-validation-contract-reuse).

**68/214 (31.8%) are complete; 146 remain.** Internal work: **56/138**; API work:
**10/48**; migration: **2/14**; final review: **0/14**. jskit-ai, vibe64, seeds
and positioning remain paused and unchanged.


### 2026-09-09: Full includes and adapter initialization verified

Completed **A6-14**. Ordinary belongsTo, hasOne and polymorphic belongsTo
includes skipped field selection when no target fieldset was supplied, omitting
SQL projections and projected computed-field dependencies. All three now call
the existing selection helpers unconditionally. No new runtime abstraction,
cache, compatibility layer or option was added.

Shared regressions cover six relationship kinds with logical zero/custom IDs,
mapped columns, full/sparse GET/query, plain/JSON:API and row policies, both before
and after a direct target read. Ordinary targets remain cold throughout the
unprimed cases. Canonical field additions refresh the attached adapter and expose
new stored/getter/computed fields before another target read. Full projection
failures preserve causes and roll back owned PATCH changes; borrowed transactions
remain caller-owned.

The frozen Node 24.6.0 gate passes **3416/3417 ordinary** (one existing canonical
fixture skip), **3445/3445 canonical**, and Express 4 **364/364** and **366/366**;
lint and docs pass. The targeted database runner passes **2097 invocation checks**.
Its five conformance files run **319 ordinary-invocation / 332 canonical-invocation
checks on each selected database**; three older suites contribute 24 fixed-SQLite
checks per invocation, and canonical invocations retain 12 ordinary pivot-policy
cases. Detailed commands, durations, source hashes and limits are in the
[verification evidence](docs/development/verification-progress.md#2026-09-09-include-field-selection-and-adapter-initialization).
The projection guide, storage inventory and API migration guide are updated.

**69/214 (32.2%) are complete; 145 remain.** Internal work: **57/138**; API work:
**10/48**; migration work: **2/14**; final review/report: **0/14**. Consumer, seed
and positioning changes remain paused; no consumer verification was run.

### 2026-09-10: Direct storage boundaries and primary ID helpers verified

Completed **A6-03**. Direct adapter checks use real compiled metadata and native
databases without resource-method orchestration for the assertions. Coverage
includes identifier quoting, bound values, physical/logical extraction,
scalar/array/null comparisons, custom serialization metadata, nonstored fields,
relationship clearing, query independence, borrowed transactions, hook-local
adapter resolution and canonical tenant/resource constraints.

The new fixture exposed declared integer/string primary IDs producing duplicate
ID columns. The shared table-schema decision now recognizes the mapped primary
column regardless of schema type; invalid implicit numeric allocation for opaque
IDs rejects before DDL. Snapshots now accept manual integer and string primary
keys while retaining single-column/non-null/type checks. Direct and generated
DDL preserve the selected key, reject duplicates and produce an empty unchanged
diff. The schema and migration guides explain the corrections. No adapter
rewrite or compatibility layer was added.

The frozen Node 24.6.0 gate passes **3435/3436 ordinary** (one existing canonical
fixture skip), **3465/3465 canonical**, and Express 4 **364/364** and **366/366**;
lint and docs pass. All **945** native checks pass, with no failures, skips or
cancellations. Each selected file uses the requested native database; DDL and
field-alteration cases intentionally use ordinary storage in both invocations.
See the [verification evidence](docs/development/verification-progress.md#2026-09-10-direct-storage-boundaries-and-declared-primary-ids)
for exact commands, counts, durations and source hashes.

**70/214 (32.7%) are complete; 144 remain.** Internal work: **58/138**; API work:
**10/48**; migration work: **2/14**; final review/report: **0/14**. Consumer, seed
and positioning changes remain paused; no consumer verification was run.

### 2026-09-10: Serializer cursors and projection callbacks in progress

A6-07 now has scalar cursor regressions, explicit ID/relationship serializer
rejections, synchronous callback enforcement and compiled projection getter
coverage. Cursor comparisons use stored values without applying write callbacks
again. Projections no longer accept storage or setter declarations; the
[migration guide](docs/GUIDE/MIGRATING_API_V2.md#custom-serializer-cursors-and-projection-getters)
explains the simpler contract, getter changes and pagination restart.

The initial full gate caught six SQLite arithmetic-projection regressions,
which are corrected by retaining numeric cursor binding types. Expanded focused
checks pass **378 ordinary / 410 canonical**. The corrected Node 24 full gate
passes **3478/3479 ordinary** (one existing skip), **3509/3509 canonical**,
Express 4 **364/364 and 366/366**, lint and docs. The expanded native matrix
passes **2309 checks** with no failures, skips or cancellations; see the
[evidence log](docs/development/verification-progress.md#2026-09-10-serializer-cursors-and-projection-callbacks).
Structured-value serializer/cursor capability work remains, so **A6-07 stays
unchecked**. Completion remains **70/214 (32.7%); 144 open**. Consumer, seed and
positioning changes remain paused.

### 2026-09-10: Structured JSON storage in progress

Built-in object/array writes now serialize consistently and decode before
computed output. Custom getters decode their own stored representation before
final shape checks. Canonical storage accepts arrays in its existing JSON
slots. Wrong-shaped setter results and JSON serialization errors fail before
SQL even with no returned record. The
[migration guide](docs/GUIDE/MIGRATING_API_V2.md#object-and-array-attributes)
explains removal of JSON-stringifying setters and string-valued object reads.

The four-file native matrix passes **738 checks** across SQLite, PostgreSQL and
MySQL in both storage modes, with no failures/skips/cancellations. The full
Node 24 gate passes **3490/3491 ordinary** (one existing skip), **3523/3523
canonical**, Express 4 **364/364 and 366/366**, lint and docs. A review strengthened
the structured input-mutation assertion; all **78** native follow-up checks pass.
Exact source manifests, counts and limitations are in the
[evidence log](docs/development/verification-progress.md#2026-09-10-structured-json-writes-and-reads).
Whole-document filters, sorting and cursors remain unfinished, so **A6-07 stays
unchecked** and completion remains **70/214 (32.7%); 144 open**. Consumer, seed
and positioning changes remain paused.

### 2026-09-10: Serializer consistency verified

Completed **A6-07**. Whole-document object/array filters and sorts now reject
explicitly; scalar JSON-key projections and custom SQL predicates remain
available. The shared PostgreSQL selection correction fixes JSON attributes and
projections under `DISTINCT` parent queries without changing application tables.
The [migration guide](docs/GUIDE/MIGRATING_API_V2.md#querying-structured-attributes)
explains declarations, queries, custom encodings and supported SQL examples.

The frozen Node 24 gate passes **3544/3545 ordinary** (one existing skip),
**3577/3577 canonical**, Express 4 **364/364 and 366/366**, lint and docs. New
Express 4 JSON cases pass **2/2 per mode**. The expanded nine-file native matrix
passes **2660 checks**, with no failures/skips/cancellations. Exact scope,
source hashes and earlier reproductions are in the
[evidence log](docs/development/verification-progress.md#2026-09-10-structured-query-capabilities-and-postgresql-json-selections).

**71/214 (33.2%) complete; 143 open.** A59/138, B10/48, M2/14, C0/14. Consumer,
seed and positioning work remains paused. Next: A6-05's shared sort contract;
a read-only probe reproduced an inconsistent lower-level object default-sort
form. Other storage and metadata requirements remain open.

### 2026-09-10: Logical sorting repairs verified

Both storage modes now resolve sort fields consistently across SQL ordering,
required sparse fields, cursor values, reference visibility and include limits.
Filter aliases can no longer redirect an overlapping resource ID or stored
attribute sort. Distinct sortable scalar aliases work with sparse cursor pages;
cursor conversion uses stored field types independently of filter input types.
Invalid object/non-string default-sort forms reject during compilation. The
[migration guide](docs/GUIDE/MIGRATING_API_V2.md#sort-fields-and-defaults) records
the selected forms, alias precedence and restart requirement for affected cursors.

The frozen Node 24 full gate passes **3580/3581 ordinary** (one existing skip),
**3613/3613 canonical**, Express 4 **364/364 and 366/366**, lint and docs.
The eight-file native matrix passes **2933 checks** with no failures/skips.
See [exact evidence](docs/development/verification-progress.md#2026-09-10-logical-sort-fields-and-cursor-comparisons).

**A6-05 remains open:** shared pagination mode/size/cursor setup is next; this
batch does not satisfy the entire item. Progress remains **71/214 (33.2%);
143 open**. Consumer/seed and positioning work remains paused.

### 2026-09-10: Shared pagination setup verified

Completed **A6-05**. The existing pagination helper now owns mode, capped size,
limit/offset and cursor parsing/validation/predicate setup. Both plugins use its
small result object for count and response branches. Together with the preceding
logical-sort repair and existing dependency selection, the core rules have
shared owners. This removes **211 runtime lines** and the ordinary first-cursor
page's discarded count query. Offset count behavior remains explicit; the
[migration guide](docs/GUIDE/MIGRATING_API_V2.md#pagination-modes-and-counts)
documents that hook/query change and the unified cursor error message.

The frozen Node 24 gate passes **3600/3601 ordinary** (one existing skip),
**3633/3633 canonical**, Express 4 **364/364 and 366/366**, lint and docs.
The nine-file native matrix passes **3359 checks**, no failures/skips.
[Exact results and ownership reconciliation](docs/development/verification-progress.md#2026-09-10-shared-pagination-setup)
also record the verified source manifest.

A read-only follow-up exposed an open **A5-03/A5-10** visibility defect: declaring
a hidden projection sortable exposes its selected value in a cursor, while
explicitly allowing a hidden stored sort field creates an incomplete cursor.
Both modes reproduce this in `/tmp/library-hidden-sort-probe.log`. Fix field
capability validation next; do not treat this milestone as final library approval.
The following hidden-sort batch resolves this finding.

**72/214 (33.6%) complete; 142 open.** A60/138, B10/48, M2/14, C0/14. Consumer,
seed and positioning work remains paused.

### 2026-09-10: Hidden sort visibility verified

Resolved **A5-F9**, a bounded defect under **A5-03/A5-10**. Existing sort helpers
now exclude hidden stored/projection fields and aliases from public sort
capabilities and reject contradictory compilation, post-hook query and include
ordering. Hidden dependencies remain usable, and normally-hidden public fields
retain sparse cursor traversal. The
[migration guide](docs/GUIDE/MIGRATING_API_V2.md#hidden-sort-fields) explains the
configuration change. No compatibility layer or new metadata representation was
added.

The initial 24-case regression suite failed 16 cases in each mode; the final
expanded suite passes **28/28 per mode**. The first full gate found label tests
inheriting a sortable `name` after replacing it with a hidden field. Their fixture
now explicitly sorts by public ID while retaining every visibility assertion.

The final Node 24 gate passes **3628/3629 ordinary** (one existing skip),
**3661/3661 canonical**, Express 4 **364/364 and 366/366**, lint and docs.
The five-file native matrix passes **1527 checks**, no failures/skips.
[Exact results and source manifests](docs/development/verification-progress.md#2026-09-10-hidden-sort-visibility)
record the fixture correction and confirm unchanged runtime across those gates.

**72/214 (33.6%) complete; 142 open.** No whole checklist item is completed by
this bounded correction. Broader compiled metadata, configuration lifetime,
storage boundaries, failure semantics, performance/types, API capabilities,
consumer migrations and final reviews remain. Consumer, seed and positioning
work remains paused.

### 2026-09-10: Incremental storage type checking verified

Completed **A9-01 and A9-10**. Four existing storage implementation modules now
use strict checked JSDoc, with unknown values and missing dictionary entries
explicit. `npm run typecheck` uses `noEmit` and is part of the existing local/CI
verification command. Internal declarations describe the existing adapters;
no runtime interface or build step was introduced. The compiler and Node 24
types use versions already in the dependency graph.

Twelve compile-time negative cases detect wrong calls, missing adapter methods,
invalid DB handles, ownership options and unguarded values. Runtime regressions
fix invalid storage naming normalization and accidental deletion of a literal
`undefined` attribute when a canonical reverse mapping is absent. A draft
thenable guard was corrected after its proxy regression failed; the final
serializer keeps the original direct property probe.

The frozen Node 24 gate passes type checking, **3639/3640 ordinary** (one existing
skip), **3673/3673 canonical**, Express 4 **364/364 and 366/366**, lint and docs.
The five-file native matrix passes **996 checks**, no failures/skips.
[Exact scope, checks and evidence](docs/development/verification-progress.md#2026-09-10-incremental-storage-type-checking)
distinguish these completed tooling items from the broader open typing work.

The follow-up public probe found **A5-F12**, an open field-namespace defect:
ordinary storage loses values for declared `constructor` and `toString`
attributes, and ordinary mapping helpers also lose `__proto__` keys. Canonical
round trips differ. Fix and test these metadata dictionary assumptions next;
see [reproduction and acceptance](docs/development/compiled-resources.md).

**74/214 (34.6%) complete; 140 open.** A62/138, B10/48, M2/14, C0/14. Consumer,
seed and positioning work remains paused.

### 2026-09-10: Prototype-named fields and minimal read mappings verified

Corrected a bounded part of **A5-F12**: own-property checks now govern ordinary
write exclusion, generated filters, virtual input, getter/setter presence,
canonical write mappings and stored-field sort visibility. Missing row values
and reverse mappings do not expose inherited functions. Eight public names are
covered across both representations and naming modes, with writes, sparse
reads and cursor traversal.

Knex discards three physical update keys: `constructor`, `prototype` and
`__proto__`. Ordinary resource registration, adapter creation and table/migration
generation now reject those mappings. Explicit `storage.column` preserves the
valid public names; canonical slots do not need the override. The migration
guide explains existing-column renames without automatically altering data.

Also resolved **A5-F13**: minimal reads converted physical columns to logical
fields twice. Write hooks and PUT completeness checks now receive the original
values when physical and logical names overlap.

The frozen Node 24 gate passes **3728/3729 ordinary** (one existing skip),
**3762/3762 canonical**, Express 4 **364/364 and 366/366**, type checking, lint
and docs. The five-file native matrix passes **1179 checks**, without failures,
cancellations or skips. All 243 source-manifest entries remained unchanged
through both gates; package dependencies and the parked consumer patch are
unchanged. See the
[evidence and limitations](docs/development/verification-progress.md#2026-09-10-prototype-named-fields-and-single-column-translation).

**74/214 (34.6%) complete; 140 open.** No whole checklist item is completed by
these corrections. Remaining F12 work includes the `__proto__` declaration
contract and related dictionary assignments, followed by the wider compiled
metadata/configuration work. Consumer, seed and positioning work remains paused.

### 2026-09-10: Declaration namespaces and relationship dictionaries verified

Completed another bounded part of **A5-F12**. Declaration maps reject reserved
`__proto__` keys and inherited declarations before copying and after enrichment.
Plain/null-prototype maps and nested JSON data remain supported. Field additions,
storage/migration helpers and canonical registry boundaries use the same checks.
Own-property lookups and assignments also correct include trees, polymorphic
grouping, relationship classification and resource fieldsets. The API migration
guide documents these distinct name contracts and existing-data implications.

The frozen Node 24 full gate passes **3783/3784 ordinary** (one existing skip),
**3824/3824 canonical**, Express 4 **364/364 and 366/366**, type checking, lint
and docs. The seven-file SQLite/PostgreSQL/MySQL matrix passes **2088 checks**,
with no failures, cancellations or skips. All 244 source-manifest entries and
the dependency/parked-consumer hashes remain unchanged through verification.
See [evidence and limitations](docs/development/verification-progress.md#2026-09-10-declaration-namespaces-and-relationship-dictionaries).

**A5-F14 remains open and is next:** a canonical write with an empty descriptor
cache can acquire a second connection outside its active transaction and time
out. This was independently reproduced; restoring tamper-test fixture state
does not fix it. Use the existing descriptor/transaction boundaries and verify
cold-cache reads, writes, relationships, rollback and isolation.

**74/214 (34.6%) complete; 140 open.** A62/138, B10/48, M2/14, C0/14. No whole
checklist item is completed by this batch. Consumer, seed and positioning work
remains paused.

### 2026-09-10: Cold descriptor transactions and shared include parsing verified

Resolved **A5-F14** by forwarding the active transaction through canonical
descriptor reads, relationship/include work and query preloading. The existing
registry ownership/cache policy is retained. The new 46-case single-connection
suite covers cold CRUD, PUT-create, relationships, nested reads, rollback and
borrowed ownership. The existing concurrency suite now starts canonical cases
with cold descriptors; error-injection checks exercise the actual transaction.

Also corrected a remaining **A5-F12** include boundary: nested prototype-named
aliases returned the right records while mutating built-in functions. Removing
the canonical duplicate parser makes both plugins use the existing shared
helper. New regressions verify both records and absence of those side effects.

The frozen Node 24 gate passes **3832/3833 ordinary** (one existing skip),
**3873/3873 canonical**, Express 4 **364/364 and 366/366**, type checking, lint
and docs. The SQLite/PostgreSQL/MySQL matrix passes **1621 checks**, without
failures, cancellations or skips. Both gates exit zero; all 245 source-manifest
entries and dependency/parked-consumer hashes remain unchanged. See
[evidence and limitations](docs/development/verification-progress.md#2026-09-10-cold-descriptor-transactions-and-shared-include-parsing).

**A5-F15 is open and next:** transaction-bound descriptor reads expose repeated
metadata work. A representative nested PATCH increases from 15 statements on
the previous warm-cache path to 57, including 42 metadata reads. Resolve this
through the compiled metadata/configuration work, comparing reuse of the
existing representation with a narrowly scoped cache. Preserve transaction
isolation and verify configuration changes while reducing the measured cost.

**74/214 (34.6%) complete; 140 open.** No whole checklist item is completed by
these corrections. Consumer, seed and positioning work remains paused.

### 2026-09-10: Published canonical descriptors and query instrumentation verified

Resolved **A5-F15** by using the descriptor already published with compiled
resource metadata, matching the storage adapter. CRUD, includes, relationship
work, counts and related query maps no longer reload registry configuration.
The related-map traversal is synchronous; redundant ID fallback selection and
the query adapter's unused registry member are removed. No extra cache or
compatibility layer was added.

Direct registry operations retain their transaction/error semantics. Raw or
registry metadata changes do not implicitly publish resource configuration;
field additions and explicit refresh do so through their existing boundaries.
Tests cover failed/missing refreshes, distinct slot mappings before/after
publication, borrowed metadata changes, unavailable-registry HTTP reads/writes,
and overlapping tenant APIs. The migration guide documents this behavior and
the changed internal helper arguments, with a new common-change navigation list.

Completed **A8-01** using the existing benchmark script. Six scenarios report
statement/configuration counts, result counts, time and heap deltas without SQL
or row output. Repeated runs match statement/result counts in both storage
modes. Canonical full PATCH drops from 32 to 11 statements and nested PATCH
from 59 to 17; metadata statements drop to zero. Ordinary counts are unchanged.
Timing/heap figures are descriptive, not pass/fail thresholds or throughput claims.

The frozen Node 24 gate exits zero: **3793/3794 ordinary** (one existing skip),
**3834/3834 canonical**, Express 4 **355/355 and 357/357**, type checking, lint
and docs. The eight-file native matrix passes **1780 checks**, without failures,
cancellations or skips; its runner exits zero. All 245 source-manifest entries
and dependency/parked-consumer hashes remain unchanged through verification.
See [evidence and limitations](docs/development/verification-progress.md#2026-09-10-published-descriptors-and-query-measurements).

**75/214 (35.0%) complete; 139 open.** A63/138, B10/48, M2/14, C0/14. Broader
compiled metadata/configuration work, workload baselines, batching/query plans
and consumer migrations remain open. Consumer, seed and positioning work is
still paused.


### Configuration lifetime audit: nested authored storage references

A5-F16 is now reproduced in four Node 24 SQLite scenarios across both storage
modes: unsupported authored mutations can change serializer behavior while
leaving cached column/serializer facts unchanged. The
[configuration-lifetime evidence](docs/development/compiled-resources.md#authored-nested-storage-mutation-configuration-lifetime-evidence)
defines the next snapshot/publication checks. No implementation item is closed;
A5-08/A5-09 remain open and the verified count stays **112/214**.


### Compilation snapshot implementation checkpoint

The compiler now owns snapshots of input declarations and published metadata.
Selected verification passes 224 SQLite and 103 PostgreSQL checks; the full gate
and MySQL run remain in progress at this checkpoint. Canonical registration-input
ownership has a reproduced follow-up and an isolated draft, pending the current
gate. See [current evidence](docs/development/verification-progress.md#2026-09-11-compilation-snapshots-under-verification).
A5-08/A5-09 remain open; **112/214** items are complete.


### Configuration input ownership verified

Compilation snapshots passed the full Node 24 gate: **11,430 passes**, one existing
skip, plus types, query budgets, lint and docs. The subsequent canonical
registration/input and sort-array ownership fixes pass **379 SQLite and 384 native
checks**, types, budgets and scoped lint. The
[evidence record](docs/development/verification-progress.md#2026-09-11-configuration-input-ownership-verified)
distinguishes the full checkpoint from the applied follow-ups. Callback identities,
compiled metadata aliases and explicit runtime sort-variable overrides are retained.
A5-08/A5-09 remain open for the broader option/customization lifetime review.
The verified checklist stays **112/214**.


### Policy and autofilter registry audit

Resolved A5-F17: plugin registry and autofilter field lookup now require own
entries, while explicitly registered prototype-like callback names remain valid.
The 20-case baseline exposed 17 failures. Applied verification passes **300 SQLite
and 464 native checks**, types and scoped lint. The
[evidence record](docs/development/verification-progress.md#2026-09-11-explicit-policy-and-autofilter-registry-entries)
records the startup-error distinctions and retained per-request policy evaluation.
Broader A5 requirements remain open; the checklist remains **112/214**.


### A5 cache/configuration lifetime acceptance

Completed **A5-08 and A5-09**. The
[acceptance matrix](docs/development/compiled-resources.md#cache-and-configuration-lifetime-acceptance)
defines scope customization, projection, physical mapping, tenant descriptor and
runtime-option cache ownership and refresh rules. The public migration guide
specifies plugin installation, awaited resource registration, enrichment working
copies, runtime overrides and supported structural publication boundaries.
Final checks pass **281 SQLite and 256 native checks**, types and scoped lint;
compiler-only measurement records the extra enrichment copy cost. See the
[verification record](docs/development/verification-progress.md#2026-09-11-cache-keys-and-configuration-lifetime-acceptance)
for exact scope and limitations. Broader metadata authority, value-boundary
migration, invalid configuration checks and consumer ports remain open.
Verified total: **114/214 (53.3%); 100 open. A91/138, B21/48, M2/14, C0/14**.


### Compiled output indexes under full verification

Response normalization now reuses compiled output field and relationship indexes,
retaining identity with existing definitions. Applied selections pass **525 SQLite
and 322 native checks**, types and scoped lint. Isolated measurements show the
removed per-record map assembly and its initialization cost; no end-to-end
throughput claim is made. The full Node 24 gate passed 11,488 checks, with zero failures and one existing
skip; types, query budgets, lint and docs also passed. See
[current evidence](docs/development/verification-progress.md#2026-09-11-compiled-output-indexes-under-full-verification).
Broader A5 metadata work remains open; **114/214** items are complete.

### Compiled foreign-key membership reuse

Existing dependency compilation now supplies foreign-key membership to identity
validation, conversion, selection and minimal reads. Tests cover retained set
identity, no mutation during reads and replacement after canonical additions.
The follow-up passed **690 SQLite and 516 native checks**, types, scoped lint and
both query budgets. See the
[verification record](docs/development/verification-progress.md#2026-09-11-reuse-compiled-foreign-key-membership).
Broader A5 items remain open; **114/214** items are complete.

### Remove duplicate polymorphic conversion scan

Conversion now uses the compiled backing-field set for polymorphic fields too,
removing its second relationship scan and temporary set. The compiled metadata
read retains typed-error and cause-preserving boundaries. Verification passed
**226 SQLite and 160 native checks**, types and scoped lint. See the
[record](docs/development/verification-progress.md#2026-09-11-remove-duplicate-polymorphic-conversion-scan)
for fixture scope. **114/214** remain complete; broader A5 work is still open.

### Reject ambiguous relationship aliases

Four reproduced registration defects now reject duplicate belongs-to aliases and
alias/declared-relationship collisions, including enriched declarations. Failed
canonical additions retain published metadata and data. Selected verification
passes **342 SQLite and 180 native checks**; the full Node 24 gate is pending.
See the [evidence](docs/development/verification-progress.md#2026-09-11-reject-ambiguous-relationship-aliases)
and migration guide. Broader A5-03/A5-10 remain open; **114/214** complete.

### Reject relationship declarations on derived attributes

Computed fields and query projections now reject ordinary and polymorphic
relationship options after enrichment. Output relationship indexing reads stored
fields only. Eight previously failing registration cases and canonical rollback
coverage pass. The previous full gate exposed duplicated declarations in one
shared fixture (60 cancelled checks); those declarations are migrated, and all
four affected suites pass in both SQLite modes. Selected totals: **241 SQLite and 282 native passes**;
the corrected full gate passed **11,519 checks**, zero failures/cancellations
and one existing skip. See the
[evidence](docs/development/verification-progress.md#2026-09-11-derived-attributes-cannot-own-relationships).
Overall remains **114/214** complete.

### Shared relationship lookup uses the compiled index

The existing lookup helper now reads the compiled relationship index. Misplaced
stored polymorphic declarations reject compilation, resolving another demonstrated
metadata disagreement before index reuse. Applied checks pass **890 SQLite and
684 native tests**, types, both query budgets and scoped lint. No new full gate is
claimed for this follow-up; the preceding source passed 11,519 checks. See the
[evidence](docs/development/verification-progress.md#2026-09-11-shared-lookup-uses-compiled-relationships).
Broad A5 items remain open; **114/214** complete.

### Request contracts reuse compiled relationship metadata

Contract construction consumes the existing backing-field set and relationship
index, removing repeated metadata derivation and duplicate linkage-schema
assembly. Cache lifetime stays unchanged. Verification passes **418 selected
SQLite checks plus two new target-precedence checks**, **390 native checks**,
types and scoped lint; fixture scope is recorded in the
[evidence](docs/development/verification-progress.md#2026-09-11-request-contracts-reuse-compiled-relationships).
Broader A5 requirements remain open; **114/214** complete.

### Broader metadata authority audit

The read-only audit found remaining plugin boundaries, including a reproduced
file MIME-rule/compiled-metadata mismatch and file backend identity concerns.
The [inventory](docs/development/compiled-resources.md#metadata-authority-audit-remaining-plugin-boundaries)
records evidence and the public regression still needed. A5-02 remains open;
configuration lifetime coverage must include these file cases. No runtime source
changed in this audit. **114/214** complete.

### File handling consumes compiled metadata

Four public regressions reproduced the file boundary defects. File discovery now
uses a WeakMap keyed by the compiled owner, including empty-list replacement;
file backend handles retain identity while MIME rules and column mappings remain
owned declaration data. Late installation and successful/failed additions are
covered. Final checks pass **336 SQLite and 434 native checks**, types and scoped
lint. See the [evidence](docs/development/verification-progress.md#2026-09-11-file-handling-follows-compiled-metadata)
for fixture limitations. A5-02 and remaining plugin audit work stay open;
**114/214** complete.

### Autofilter metadata publishes with the compiled owner

Two public canonical regressions now pass: current aliases are used after
recompilation, and missing required filter fields reject before publication.
The new `schema:compiled` hook derives plugin facts on the candidate before the
existing owned snapshot; autofilter reads that owner without a second scope copy.
Checks pass **195 SQLite and 286 native checks**, with another 44 fixed-SQLite
checks in the native jobs, plus types and scoped lint. See the
[evidence](docs/development/verification-progress.md#2026-09-11-autofilter-metadata-publishes-atomically)
and separately documented hook/deep-metadata API migration. A5-02 and the remaining
plugin initialization audit are open; **114/214** complete.

### Include configuration validates the compiled candidate

Consolidated include validation at `schema:compiled`, fixing seven reproduced
registration defects and removing the duplicate authored-options check. Explicit
resource maxima, enriched definitions, numeric/sort shape and failed canonical
publication are covered. Selected checks pass **330 SQLite and 536 native tests**,
types and scoped lint. The accumulated full Node 24 gate passed 11,568 tests,
with zero failures and one existing skip, plus types, budgets, lint and docs; see the
[evidence](docs/development/verification-progress.md#2026-09-11-include-configuration-validates-the-compiled-candidate).
Broader A5 work remains open; **114/214** complete.

### Checked filtering lifecycle boundary

The existing query-filtering helper and permission method now have strict checked
contracts for builder state, deferred hooks and restoration. Negative type
fixtures and seven runtime context checks pass. This advances A6-02/A9 without
claiming full data-helper/lifecycle coverage; **114/214** remains complete.
See [type coverage](docs/development/typechecking.md#query-filtering-context).

### Write-helper signature inventory

Both storage plugins now declare their existing write/existence inputs and
backend-specific results. Strict contract fixtures, scoped lint and docs pass.
Plugin bodies remain dynamically typed; read and broader lifecycle typing
remain open. **114/214** complete. See the
[boundary inventory](docs/development/storage-boundaries.md#write-helper-signatures).

### Negative type-contract acceptance

A9-06 is complete: the nine compile-time fixtures reject invalid adapter calls,
transaction/filtering stage inputs and incompatible data results. Removing only
expectation comments in memory produced exactly 56 intended diagnostics at 56
sites, with no missing or extraneous errors. Normal types and scoped lint pass.
This does not close broader checked implementation or consumer declaration work.
**115/214 complete (53.7%); 99 open. A92/138, B21/48, M2/14, C0/14.**

### In-place logger enhancement

Fixed a reproduced recursion defect in the existing enhancement utility by
capturing original writers before replacement. Three baseline regressions and
462 applied utility/error/HTTP checks establish the fix; types and scoped lint
pass. Diagnostic redaction/bounding and upstream logging work remain open.
**115/214 complete; 99 open.**

### Diagnostic cause preservation

The existing formatter now retains native cause/aggregate properties and nested
error messages, with the existing stack/depth/cycle policies. Four baseline
failures are fixed; the applied utility/error/HTTP selection passes 470 checks.
Broader A9-07/A9-08 requirements remain open. **115/214 complete; 99 open.**

### Diagnostic output ownership and filter payloads

Recorded direct library and upstream output owners in the
[diagnostic boundary inventory](docs/development/diagnostic-boundaries.md).
Removed values and definitions from shared basic-filter traces. A real hidden
field check preserves SQL bindings/results while proving those payloads absent;
10 selected checks pass across both storage modes. Broader diagnostic work
remains open. **115/214 complete; 99 open.**

### Direct operation log payloads

Removed raw storage request/filter/attribute payloads, stored upload URLs and
subscription filters from their operation log messages. The selected filter,
file and real Socket.IO suites pass 157 tests, with scoped lint clean. The full
Node 24 gate passed 11,584 tests, zero failures and one existing skip, plus types,
query budgets, lint and docs. A9-07/A9-08 remain open. **115/214 complete; 99 open.**

### Pending upstream diagnostic payload fix

A separate three-line `hooked-api` patch removes automatic raw parameter/option
dumps. Six regressions fail on the installed source and pass on both the draft
and its composition with the prior thrown-value fix. It remains uninstalled and
needs upstream full verification/release and deliberate dependency integration.
**115/214 complete; 99 open.**

### Include diagnostics use counts

Applied the seven-site log-only include cleanup after the 11,584-pass gate.
Non-logging ASTs are identical; 164 selected include checks and scoped lint pass.
Broader diagnostic fields/redaction/bounding remain open. **115/214 complete; 99 open.**

### Composed upstream patch verification

The saved thrown-value and diagnostic-payload patches apply together and match
the manifest hash. The composed copy passes 295 upstream tests when run alone,
six payload regressions and 24 library integration checks. An initial concurrent
run failed wall-clock stress thresholds; its failure and unchanged isolated rerun
are recorded. Both patches remain uninstalled pending upstream release and
intentional dependency integration. **115/214 complete; 99 open.**

### Connector diagnostic route templates

Express/Fastify error metadata now uses registered route patterns and omits raw
request URLs. Two baseline regressions are fixed; 370 selected HTTP checks pass,
including Express 4 in both storage modes. Connector scripts retain the new
suite. Broader diagnostic requirements remain open. **115/214 complete; 99 open.**

### Bounded formatted-error previews

The existing formatter now limits entries, traversal and copied text, with
explicit truncation and unchanged source errors. Five new cases cover breadth,
text, custom JSON and traversal behavior; 484 selected checks and scoped lint
pass. A9-08 remains open for other output paths and redaction.
**115/214 complete; 99 open.**

### Bounded error summaries

One-line summaries now share bounded formatting and a 2,048-character output
cap, without invoking custom JSON conversion or unrelated detail getters.
Two baseline regressions are fixed; 488 selected checks and scoped lint pass.
Other logging paths and redaction remain open. **115/214 complete; 99 open.**

### Bounded enhanced-log events

The existing serializer now also bounds entire enhanced-log argument lists.
Validation errors emit one structured event instead of a duplicate detail event.
Two baseline regressions are fixed; 492 selected checks, types and scoped lint
pass. Direct/upstream output and sensitive-field redaction remain open.
**115/214 complete; 99 open.**

### Compiled field visibility in write diagnostics

The bounded serializer and summaries now support structured-field redaction.
Write errors derive hidden/normally-hidden names from compiled output fields.
Two baseline failures are fixed, and a real compiled-resource failure verifies
redaction, rollback and unchanged input. 498 selected checks, types and scoped
lint pass. Broader A9-08 coverage remains open. **115/214 complete; 99 open.**


### Contributor testing instructions reconciled

The two testing guides previously recommended removed response options and
contradictory restrictions on plain-format coverage. `tests/README.md` is now
the contributor reference, with the older development-guide path linking to it.
It documents shared fixture ownership, reset/cleanup, current format/returning
options, Node 24, focused commands, native database/Redis prerequisites, and the
limits of the full library gate. Root README and AGENTS instructions agree.
Local links and npm script names resolve; docs build and whitespace checks pass.
A10-05 is complete. **116/214 complete; 98 open. A93/138, B21/48, M2/14, C0/14.**
The accumulated diagnostic full gate remains running; no new whole-library
verification result is claimed yet.


### Accumulated diagnostic verification and HTTP follow-up

The accumulated Node 24 gate passes **11,614 tests**, zero failures/cancellations,
one existing skip, plus types, both query budgets, lint and documentation.
All 294 checkpoint source hashes match. The subsequent HTTP/early-write
redaction fix is now applied with maintained regressions; **506 focused checks
pass**, plus type checking, scoped lint, whitespace and docs. This follow-up is not included in the preceding full-gate result.
A9-08 remains open for the documented remaining output boundaries.
**116/214 complete; 98 open.**


### Logger metadata copying respects the existing formatter

Hidden and omitted top-level metadata is now formatted before convenience
methods or error envelopes copy it. Three counter-based regressions fail on
the preceding source; 146 focused checks and scoped lint pass after the fix.
The diagnostic inventory records the boundary and remaining scope. A9-08 stays
open. **116/214 complete; 98 open.**


### Version-field configuration groundwork

The existing compiler now validates an explicit stored string `versionField`
and preserves its declared visibility. The selected revision representation is
an opaque token. Ten initial regressions failed before implementation; 121
version-configuration/schema-enrichment checks, scoped lint and types pass.
Token generation, write protection, atomic conditions and HTTP integration are
still required. All B3 items remain open. **116/214 complete; 98 open.**


### Exact revision conditions verified on native databases

A real MySQL regression exposed trailing-space equality in version predicates.
Byte comparison fixes it. The expanded storage-primitive matrix passes **60
checks** across SQLite/PostgreSQL/MySQL and both storage modes, including two
simultaneous transactions competing for the same revision. Public write-method
and HTTP integration remain required; all B3 items remain open.
**116/214 complete; 98 open.**


### Direct versioned writes integrated; B3-01 complete

Direct POST/PUT/PATCH/DELETE now initialize or rotate opaque revisions inside the
existing transaction and reject stale conditions and caller-supplied version
attributes. Locally held generated tokens survive input mutation by hooks;
failed write hooks roll back both token and attributes. The selected contract
is documented separately from remaining concurrency work.

The three-suite native selection passes **180 checks** across SQLite,
PostgreSQL and MySQL in both storage modes. Existing lifecycle/cleanup checks
pass **845 per storage environment, 1,690 total**. No failures/cancellations/skips;
types and scoped lint pass. Public concurrency, permission/error semantics,
relationship/bulk conditions, migration and HTTP validators remain open.
**117/214 complete; 97 open. A93/138, B22/48, M2/14, C0/14.**


### Public concurrent revision tests verified; B3-09 complete

Two public PATCH calls reach a hook barrier with separate transaction connections
and the same expected revision. One succeeds, one rejects, only one successful
write hook runs, and the stored attributes/token match the winner. The complete
ten-case direct-method suite passes all six driver/storage combinations: **60
passes**, zero failures/cancellations/skips. SQLite may reject its competing
writer with its native busy error; PostgreSQL/MySQL require a version conflict.
An isolated PostgreSQL mutation removing only the revision predicate produces
six expected failures, including both race tests accepting two writes. Runtime
source was not changed by the mutation loader. B3-09 is complete; broader
relationship/bulk/HTTP and authorization work remains open.
**118/214 complete; 96 open. A93/138, B23/48, M2/14, C0/14.**


### Relationship endpoint version conditions integrated

Relationship PATCH forwards `expectedVersion`; POST/DELETE atomically rotate
and check the parent revision in the existing transaction. Three initial
regressions fail before the fix. Has-many/many-to-many cases pass **36 native
checks**, with **306 existing related/permission/cleanup checks** also passing,
plus types and scoped lint. Broader invalidation/bulk/HTTP acceptance stays open.
**118/214 complete; 96 open.**


### Version conflict errors and visibility verified; B3-05 complete

Visible stale revisions now raise `RestApiVersionConflictError` with stable code
`REST_API_VERSION_CONFLICT`; HTTP mapping returns 409 without revision values.
Conditional PUT-create now returns not found, matching a policy-hidden row at
the same ID. Direct and relationship cases verify original typed causes,
rollback and identical hidden/missing mapped responses. The native selection
passes **168 checks**, with **386 HTTP/formatter regressions**, types and scoped
lint also passing. This does not implement HTTP conditional headers or finish
broader version invalidation/bulk/migration work.
**119/214 complete; 95 open. A93/138, B24/48, M2/14, C0/14.**


### Bulk revision conditions integrated

Bulk PATCH/DELETE accept aligned `expectedVersions` arrays, validate conditions
before child work and forward each token through the existing single-write API.
Both HTTP connectors accept the array in bulk request bodies. Creation and
singular bulk conditions reject. The combined version/bulk cleanup/authorization
selection passes 852 checks across all six native driver/storage combinations;
types, scoped lint and whitespace pass. B3-10 stays open for its complete scope.
See [bulk evidence](docs/development/verification-progress.md#2026-09-11-bulk-revision-conditions).


### Version-field migration verified; B3-03 complete

The explicit field allocation/backfill/restart workflow passes 36 native checks.
The guide includes ordinary and canonical examples, visibility, validation,
retry, rollback and readiness rules. The backfill example is a one-off migration
artifact, not an added runtime API or automatic table mutation. The preceding
accumulated Node 24 gate passed 11,794 tests, one existing skip, types, budgets,
lint and docs; migration additions were verified separately afterward.


### Inverse reference invalidation in progress

Child POST/PUT/PATCH/DELETE now invalidate affected versioned inverse parents
for ordinary and polymorphic has-many/has-one references within the child
transaction. Three original regressions fail before the fix. Expanded version
selections pass 198 native checks; lifecycle/failure regressions pass 1,902
checks, and types, budgets and scoped lint pass. B3-02 remains open for
many-to-many/pivot writers, cascades and its broader invalidation contract.
See [inverse evidence](docs/development/verification-progress.md#2026-09-11-inverse-reference-version-invalidation).


### Many-to-many inverse revision writers verified

Both storage writers now invalidate configured versioned inverse resources on
attachment, replacement and removal. Updates and removed-link reads are bounded;
new tokens are distinct per affected row. Direct low-level calls maintaining
these revisions require an active transaction. The native selection passes 114
checks, existing large-pivot/canonical-link regressions pass 77, and types,
query budgets and scoped lint pass. Direct pivot-resource writes and
source deletion/cascades remain open under B3-02.
See [many-to-many evidence](docs/development/verification-progress.md#2026-09-11-many-to-many-inverse-revisions).


### Direct pivot-resource revision tracking verified

Ordinary through-resource writes now invalidate affected versioned parents when
either pivot key changes, on creation or on deletion. Caller rollback restores
both. Canonical through-resource records remain separate from canonical links;
that distinction is tested and documented. The expanded inverse suite passes
84 native checks, with 6 additional focused rollback/storage checks; types and
scoped lint pass. B3-02 still includes source deletion/cascade acceptance.
