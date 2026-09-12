# Application input and hook context review

This work implements the later API decisions independently of the archived
consumer-migration goal. jskit-ai, vibe64 and their seeds remain untouched.

## Contract decisions

- Resource POST/PUT/PATCH take exactly one own input member: `data` for ordinary
  values, or `document` for a JSON:API document. Presence selects input, including
  explicitly undefined members; supplying both rejects. `inputRecord` is removed.
- `format` selects output only, with the existing configurable plain default.
  `returning` keeps its existing full/minimal/none semantics. Read calls need no
  input key. No separate `api.jsonapi` facade or compatibility parser was added.
- Bulk POST accepts a plain array under `data` or a resource array in
  `document.data`; bulk PATCH entries use the same singular input selection.
  Existing custom bulk HTTP payloads are translated at the HTTP boundary.
- Document `meta`, `links` and `jsonapi` objects survive normalization for hooks.
  They are not stored attributes. `errors` and `included` write members reject;
  no compound-write or extension support is implied.
- Both forms enter the existing normalized document pipeline. Storage, query,
  transaction and response-preparation implementations remain shared. Required
  response preparation still precedes owned commit.
- Hook context remains mutable and caller-visible. Its internal `inputRecord`
  field retains the normalized document; renaming the public argument does not
  rename that hook field. No replacement context mechanism was introduced.
- Chapter 13 now documents writable fields and phases, internal fields,
  permission/enrichment wrappers and shallow nested inheritance. Independent
  operations need independent contexts; nested custom object references can be
  deliberately shared.

## Independent reviews

The implementation review found and corrected two issues before final acceptance:

1. Per-entry validation before calling bulk PATCH's child wrapper omitted the
   no-write transaction outcome. Passing the original entry through the existing
   PATCH wrapper restores validation and outcome ownership in one place.
2. One mechanically migrated low-level setter test passed `document` where the
   internal context still requires `inputRecord`. The fixture was restored.

A separate agent, explicitly configured with low reasoning effort, performed a
read-only technical/adoption assessment. It did not run tests. Its complete,
verbatim report is saved in [Technical standing and developer appeal](technical-adoption-assessment.md).
The following is an abridged summary of its judgment:

- The compelling niche is an integrated resource/service layer: common direct
  and HTTP behavior, relationship-aware permissions, includes, pagination,
  transactions and completion hooks. Competing primarily as a generic mini-ORM
  would understate these benefits and invite comparisons on weaker areas.
- Concrete strengths include explicit sequential runtime hooks, batched include
  loaders, mandatory constraints separate from user filters, and query-budget
  assertions alongside result checks.
- Main obstacles are phase-specific mutable context, manually supplied resource
  typing rather than rich schema inference, unsettled API history, and documented
  backend/feature limits. Node 24+ and the declared GPL-3.0-or-later license also
  affect which teams will consider it.
- Best fit: a Node/Knex team building a relationship-heavy, permission-heavy
  JSON:API application. Less compelling for database access alone, sophisticated
  managed domain entities, or extensive non-SQL adapter requirements.
- Test breadth and source structure do not establish production scale,
  maintenance longevity or community adoption. No such claim was made.

Sources inspected include `lib/runtime/json-rest-api.js`,
`plugins/core/lib/querying/include-to-many.js`,
`plugins/core/lib/querying/query-constraint.js`, `types/runtime.d.ts`,
`scripts/measure-query-baseline.js`, the API/architecture guides and manifest.

## Verification

Validated on Node 24.6.0, against base commit `0618f1d`. These changes are
uncommitted; no consumer repositories were changed or package published.

- The ordinary SQLite suite ran 6,060 tests: 6,055 passed, four failed because
  fixtures or expected diagnostics still used the old public contract, and one
  canonical-storage-only test skipped. Those four tests were corrected and all
  four passed in a focused rerun. The whole ordinary suite was not repeated.
- The full canonical AnyAPI suite passed all 6,126 tests. Express 4 connector
  checks passed 508 ordinary-storage and 510 canonical-storage tests. Combined
  with the corrected ordinary cases, this covers 13,203 passing test executions.
- Focused PostgreSQL 16.15 checks passed 245 tests per storage mode; MySQL 8.0.46
  passed 241 per mode. These selected input, context, bulk, file-failure and
  relationship-write tests plus executable tutorial/migration guides; they were
  not a repeat of the complete native database matrices.
- Redis 7.0.15 integration passed 46 tests per storage mode, covering real
  cross-server notifications and lifecycle behavior.
- Type checking passed, and query budgets passed for both storage modes. All nine
  executable documentation checks passed, including the ordinary repository
  example and cross-format input/output examples.
- The initial `npm run verify` invocation stopped at the four stale test cases.
  Remaining stages were run separately. Lint then found two brace-formatting
  errors in a migrated test; they were fixed, and the final lint run passed.
  This is completed verification through the recorded runs, not a claim that
  one uninterrupted `npm run verify` invocation exited successfully.
- Final documentation build and packaged public-type checks passed: 165 package
  files, 428,174 packed bytes, 245 local documentation links, 29 runtime exports
  and 17 negative type checks. The checked package SHA was
  `13a245f47827155b25a28c2b10e55533dcbf7865`.
- Generated-site checks passed for all 39 pages: local targets, anchors, asset
  references, unique IDs and one primary heading per page. No layout changes
  were made and no browser was launched for this task.
- `git diff --check` passed. The three disposable PostgreSQL, MySQL and Redis
  server processes and their data directories were removed by the test runner.

Detailed logs are temporary development artifacts under `/tmp/jra-input-*`.
The final read-only documentation review found no stale public-input or
input-format claims in maintained documentation, examples or scripts.
