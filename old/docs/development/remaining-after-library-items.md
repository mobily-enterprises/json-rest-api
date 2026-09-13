# The 60 items remaining after the eight library items

**Historical snapshot below.** The 2026-09-13 jskit-ai migration closes M-07,
M-08, R-B0-07 and R-B1-05. The current master has **56 open items**: 10 migration
coordination, 32 consumer residuals and 14 final cross-repository review/report
items. See [accepted evidence](pending-jskit-ai/preparation-status.md#accepted-jskit-ai-migration-2026-09-13).

Snapshot: 2026-09-12. All eight library entries are accepted; comprehensive post-cleanup verification passed and work is paused before consumers. The [master plan](../../library-improvement-plan.md) remains the only completion ledger.

There are 46 overlapping consumer migration/acceptance entries and 14 final review/reporting entries. A migration batch can satisfy several entries; these are not 60 independent implementation projects. Consumer repositories remain paused.

## Migration coordination (12)

- **M-02** — Trace direct, indirect, dynamic, and generated use of resource methods, response shapes, options, hooks/context, serializers, projections, policies, transactions, and imports across those repositories.
- **M-03** — Record baseline consumer workflows: CRUD, user/workspace repositories, permissions and tenant isolation, HTTP/client behavior, assistant pagination, relationships, transactions, and any newly added expansion features.
- **M-05** — Record each intended breaking change with old/new call examples, affected source/tests/templates/apps, data implications, and the checks proving migration. Decide default behavior once; do not leave old/new parsers in the runtime.
- **M-06** — Reassess each architectural proposal against a demonstrated problem, comparing a local fix, direct API simplification, and internal refactoring. Retain working internals when change buys nothing; keep required correctness/capability work open.
- **M-07** — Before every migration batch, refresh branches, diffs, and usage searches against the ongoing jskit-ai expansion. Work in isolated checkouts when needed and reconcile overlapping edits without discarding either task's work.
- **M-08** — Reconcile the [parked first migration batch](pending-jskit-ai/README.md) against current source, then finish porting jskit-ai's host, shared CRUD repositories, user/workspace repositories, dependency declarations, and tests alongside the changed library surface. Add no runtime compatibility bridge.
- **M-09** — Port generated-code templates, authored examples, integration documentation, and fixtures; run the owning repository's documented generators and review their outputs. Regeneration must produce the new API directly.
- **M-10** — Port vibe64 and its public/accounts seed branches, including custom hooks, repositories, HTTP/client consumers, and dependency/lockfile updates. Its migration is not proven by jskit-ai's tests alone. Document equivalent steps for the maintainer's later ports of other apps without changing those apps here.
- **M-11** — Remove obsolete aliases, duplicate argument/return handling, forwarding imports, and consumer workarounds after their responsibilities are covered. Search actual consumers and generated outputs for remaining old calls.
- **M-12** — After the expansion advances or finishes, repeat the consumer inventory and reconcile new call sites, changed templates, and package versions. Elapsed time alone does not establish readiness or completion.
- **M-13** — Run jskit-ai, vibe64, and both seeds' required checks against the intended local artifacts, then exercise representative real workflows. Record exact source revisions, package resolution, results, and any remaining gaps.
- **M-14** — Prepare a coordinated version/dependency and migration record identifying the compatible library/jskit-ai/vibe64/seed revisions and the prerequisites for later app migrations. Local paired changes must be reviewable and fully tested; remote publication/deployment remains outside scope.

## Consumer acceptance (34)

- **R-A4-01** — Finish the actual JSKIT/app custom-hook inventory and reconcile downstream assumptions with the documented library contract.
- **R-A4-04** — Migrate removed or changed consumer hook/context fields and execute the prepared consumer context contracts.
- **R-A4-08** — Port and verify actual consumer POST calls, including IDs, permissions and selected response behavior.
- **R-A4-10** — Verify migrated consumer PUT replacement and omitted-relationship assumptions; port deliberately changed behavior.
- **R-A4-12** — Migrate and verify consumer response-option calls and dependent wrappers.
- **R-A4-13** — Verify consumer serializer/temporal declarations, includes and fieldsets after removing downstream response repair.
- **R-A4-16** — Remove remaining obsolete consumer/app/template/generated callers and reconcile the final combined old-path search.
- **R-A4-18** — Execute migrated JSKIT/app workflows and compare their hook/response traces with the selected lifecycle contract.
- **R-A5-06** — Migrate and verify consumer schemas, serializer declarations and value/temporal transformations against the installed v2 artifact.
- **R-A5-10** — Reconcile actual consumer late-customization and registration callers; verify their accepted configuration timing.
- **R-A5-11** — Migrate actual consumer hook/schema metadata readers and remove obsolete downstream metadata views.
- **R-A6-09** — Complete the external query-hook inventory, port removed proxy usage and execute retained consumer query forms.
- **R-A6-10** — Migrate actual external query hooks to native builders and the selected column/value helpers; remove downstream compatibility behavior.
- **R-A6-16** — Execute actual migrated consumer raw queries and custom hooks on the databases those consumers support.
- **R-A7-01** — Reconcile JSKIT/app transaction owners and migrate ambiguous completion/event handling.
- **R-A7-07** — Migrate consumer ownership and side-effect handling; verify participant calls cannot commit or roll back their owner.
- **R-A8-04** — Verify downstream permission/query/child-hook assumptions after the retained batching changes. Further library bulk/reverse-write work is separately tracked by R-L01.
- **R-A8-12** — Record performance and workflow regressions from the actual migrated consumers; compare against their prior behavior.
- **R-A9-09** — Type-check actual migrated JSKIT/app consumers against the intended installed declaration artifact.
- **R-A10-08** — Migrate and verify actual JSKIT/app/template/generated deep imports and their optional plugin dependencies.
- **R-A10-09** — Install the intended tarball into paired JSKIT/app checks and verify exact dependency resolution, plugins and real workflows.
- **R-A10-10** — Verify clean migrated-consumer installations, Node 24 engines and coordinated dependency/lockfile changes.
- **R-B0-07** — Port and verify actual JSKIT HTTP/client/assistant consumers, including pagination and changed error/response payloads.
- **R-B0-09** — Port JSKIT and selected app/seed callers, templates and generated repositories; verify mappings, policies, includes and pagination through Part M.
- **R-B0-11** — Remove consumer workaround wrappers after installed-artifact tests prove equivalent behavior; retain useful domain integration.
- **R-B0-12** — Verify migration examples against migrated consumer artifacts, regenerate callers and search consumers for old spellings/imports. Final packaged-library example execution is separately tracked by R-L02.
- **R-B1-02** — Migrate and verify actual consumer error classification, retry decisions and nontransactional diagnostics.
- **R-B1-04** — Verify migrated consumer after-commit handling and application callbacks do not blindly retry committed writes.
- **R-B1-05** — Verify migrated JSKIT HTTP/schema/client outcome propagation and application status mapping.
- **R-B2-01** — Integrate or replace actual JSKIT/app transaction helpers with the selected owner; remove overlapping ownership wrappers.
- **R-B2-07** — Port affected consumer raw-transaction callers and verify raw SQL participation inside the selected managed owner.
- **R-B2-10** — Migrate JSKIT/app helpers and call sites, remove overlapping wrappers and execute real multi-operation success/rollback workflows.
- **R-B4-02** — Port consumers that relied on silent partial success and verify intended failure handling.
- **R-B4-07** — Verify migrated JSKIT/app failed-response handling, including committed and uncertain write outcomes.

## Final review and reporting (14)

- **C1-01** — Review every milestone against its acceptance conditions in production code and tests across all changed repositories; verify each architectural change earns its complexity.
- **C1-02** — Review the whole final patch for contract and migration completeness: methods, payloads, options/defaults, imports, hook/context behavior, transaction ownership, supported backends, and separately scoped capabilities across library, jskit-ai, and apps.
- **C1-03** — Perform an adversarial pass over interactions: malformed values, nulls, sparse fields, custom IDs, serializers, projected sorts, empty/cyclic relationships, auth boundaries, hook mutations, failures, and concurrent operations.
- **C1-04** — Check that links, cursors, schemas, imports, declarations, generated source, and migration/documentation examples are accepted by their actual current consumers.
- **C1-05** — Check for duplicate normalization/validation, global state, stale caches, swallowed errors, speculative adapters, excessive mode flags, old/new API translation, and any runtime layer maintained solely for backward compatibility.
- **C1-06** — Confirm deleted/moved code has no remaining library, jskit-ai, app, template, or generated callers. Verify removed aliases/imports are absent from runtime and published declarations.
- **C1-07** — Add regression tests for confirmed final-review findings and fix them before repeating affected checks.
- **C2-01** — Run the final complete library gate and jskit-ai/downstream-app checks against the same intended artifacts, including both storage modes, real databases/connectors, lint, types, docs, examples, and package installation.
- **C2-02** — Record actual test/pass/fail/skip counts per job, source revisions, package resolution, runtime/driver versions, commands, and conditions. Explain every material coverage limitation.
- **C2-03** — Compare final query budgets, performance measurements, initialization costs, and package contents against A0 baselines.
- **C2-04** — Run git diff --check in each changed repository and inspect final status/diffs for generated artifacts, unintended dependency changes, and interference with the concurrent expansion.
- **C2-05** — Reconcile every checklist item and migration decision against the latest jskit-ai expansion and app inventory. Unexecuted required work stays open and the execution goal must not be marked complete.
- **C2-06** — Produce a self-contained report separating internal improvements, API changes/capabilities, and jskit-ai/app migrations, with exact verification, fixed defects, performance evidence, and limitations.
- **C2-07** — Mark the execution goal complete only after required implementation, the jskit-ai and vibe64 migrations, artifact verification, documentation, and the final report are complete.
