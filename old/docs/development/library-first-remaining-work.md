# Library-first remaining work

**Current revision 3, 2026-09-12: 190/250 complete (76.0%); 60 open.** The
[master plan](../../library-improvement-plan.md) is authoritative. The maintainer
explicitly requested closing completed mixed entries and creating new items
containing only their unfinished work. This authorized the change from 214 to
250 items; it adds no product scope and does not claim completed migrations.

| Remaining category | Open items | Master location |
| --- | ---: | --- |
| Original library-only requirements | 0 | All Part A library requirements accepted |
| Separate remaining library work | 0 | [R-L01/R-L02](../../library-improvement-plan.md#r-l-remaining-library-work) |
| Consumer requirements from the former mixed items | 34 | [Part R consumer acceptance](../../library-improvement-plan.md#r-m-remaining-consumer-acceptance) |
| Part M migration requirements | 12 | Part M |
| Final review and report | 14 | C1/C2 |
| Total | 60 | |

All **eight requested library items are accepted**. Post-cleanup comprehensive verification passed; work is paused before consumers. The 34 consumer residuals and twelve
Part M items describe overlapping migration acceptance and coordination: they
are not 46 separate migrations. The fourteen final items require the eventual
combined review and report. No fixed count of 27 prerequisites is supported.

## Eight library items accepted

| Item | Concrete remaining acceptance |
| --- | --- |
| A7-05 — complete | SQLite release and Redis setup/shutdown failure owners are corrected and verified (23 SQLite + 36 real Redis cases). |
| A9-03 — complete | Actual lifecycle/storage checking, scoped regressions and independent review accepted; see [typechecking evidence](typechecking.md). |
| A9-04 — complete | Actual lifecycle/storage checking, scoped regressions and independent review accepted; see [typechecking evidence](typechecking.md). |
| A9-05 — complete | Implementation and packed declaration corrections pass internal and installed-consumer type checks. |
| A9-07 — complete | The final reporting-owner map and targeted metadata/failing-writer regressions are accepted. |
| A9-08 — complete | Sensitive-field/binary/bounds checks, known HTTP parser protection, and explicit external-text/no-resource limits are accepted. |
| R-L01 — complete | Measurements passed in all six database/storage combinations; the [recorded decision](query-measurements.md#bulk-and-reverse-child-writes-retained-lifecycle-decision-2026-09-12) retains ordered per-child hooks and writes. |
| R-L02 — complete | Literal migration examples pass against the extracted final package in both SQLite modes, plus the schema guide mapped-ID/generated-migration example. Artifact SHA-1 `7de97a9f055111af4c797dd3ca2c9becbcce2421`; the same artifact passed public declaration checks. |

The A9 typing items share one implementation review; the two diagnostic items
share reporting-owner acceptance. Item counts therefore do not represent
separate equal-sized projects. R-L01 preserves the unfinished measured work
from A8-04/A8-12; R-L02 preserves the final artifact check from B0-12.

A7-05 is complete; its [secondary-failure owner map](diagnostic-boundaries.md#a7-05-secondary-failure-reconciliation-2026-09-12) records the SQLite release and Redis cleanup/diagnostic corrections and regressions.

Existing transaction, file, registry, broadcast and connector coverage is already
accepted in that owner map. A7-05 does not require another unspecified audit of
those completed owners. The
[current verification checkpoint](pending-jskit-ai/preparation-status.md#completed-verification-checkpoint)
records the completed Node 24 checks and their scope; its earlier checklist
counts are historical and superseded by revision 3.

## Completed work reconciled in revision 3

| Reconciliation | What changed in the checklist |
| --- | --- |
| A5-02, A5-03 and A5-12 | Closed against existing compiled-metadata implementation, tested field resolution, removed redundant helpers and recorded cost evidence. They are no longer carried as unfinished library work. |
| The 34 former mixed A/B entries | Reworded to their completed library scope and closed. Their exact unfinished consumer requirements moved to the matching R-A*/R-B* IDs; two remaining library requirements moved to R-L01/R-L02. |

The 34 closures are **bookkeeping, not 34 newly implemented features**. They do
not claim that the archived consumer patch has run or that any migration has
landed. The [Part R split](../../library-improvement-plan.md#part-r--only-work-remaining-from-completed-mixed-entries)
preserves traceability, and one verified consumer workflow can satisfy multiple
linked acceptance items. Part A is 138/138 complete, Part B 48/48, Part M 2/14,
Part R 2/36 and final review/report 0/14.

Relevant existing evidence includes the
[input/context verification](../../api-input-context-review.md#verification),
[native builders and custom filters](verification-progress.md#2026-09-11-applied-native-builders-and-custom-filter-helpers),
[query and compiled-metadata measurements](query-measurements.md),
[clean package and declaration follow-up](../../../last_todo.md#follow-up-useful-features-and-supported-boundaries),
and [completed current verification](pending-jskit-ai/preparation-status.md#completed-verification-checkpoint).
No tests were rerun solely to reconcile this ledger.

## Current execution boundary

Targeted Node 24 tests and comprehensive checks when strictly justified are
authorized. Keep active jskit-ai, integrations, vibe64, seeds, shared dependency
installations and consumer generated outputs untouched. The prepared 42-file
consumer patch is archived; source preparation does not establish completed
consumer migration or verification. See the
[preparation status](pending-jskit-ai/preparation-status.md).

## Historical evidence below

All counts, mixed-item pause rules, positioning exceptions and hooked-api
statements below describe earlier checkpoints. Revision 3 above supersedes
those counts and rules. The local runtime replaced hooked-api, later work
advanced positioning, and completed mixed library scopes are now closed with
explicit residual items. Retain the historical records as evidence, not current
blockers or instructions to reopen completed work.

## Historical Part B pause point, 2026-09-11

At this checkpoint, the maintainer explicitly confirmed the instruction: pause
after the library-only portion of Part B, before a separate broad cleanup and commit/push.
Finish independently actionable library work; consumers remain paused and mixed
checkboxes stay open until their separate consumer acceptance is complete.

| Part B area | Complete | Open |
| --- | --- | --- |
| B0: Light ORM API simplification | 7/12 | 5 |
| B1: Transaction outcomes | 4/7 | 3 |
| B2: Managed transactions | 7/10 | 3 |
| B3: Optimistic concurrency | 11/11 | 0 |
| B4: Read-error policy | 6/8 | 2 |
| Total | 35/48 | 13 |

Twelve of the thirteen items open then explicitly included consumer acceptance.
B0-08 was the library-only exception: dynamic-call evidence had been reconciled;
the explicitly paused positioning HTTP example remained.
Passing the library test suite does not close the consumer portions.

B1's remaining guarantees also depended on the parked hooked-api fixes. A read-only
npm registry check on 2026-09-11 reported version 1.0.24; no newer published
release was available to replace the installed dependency. The retained patch
had not been installed or published. See the
[dependency evidence](pending-hooked-api/README.md) and
[local API migration audit](local-api-migration.md).

## Historical library-only Part B acceptance at pause

Work was paused at the requested boundary. The 13 Part B checkboxes open then
were retained; this table records their independently actionable library portions
at that checkpoint, including exceptions subsequently addressed.

| Open items | Library evidence accepted here | Still deferred |
| --- | --- | --- |
| B0-07 | Explicit connector format/return controls; full HTTP, CORS, bulk and Express 4 checks | Consumer transport/client migration |
| B0-08 | Local named/dynamic call reconciliation; full tests, declarations and executed examples | Paused positioning HTTP example |
| B0-09, B0-11 | Selected API/migration map and direct temporal/fieldset/error contracts tested | Actual consumer ports and wrapper removal |
| B0-12 | Selected migration After snippets executed against the packed library; local legacy audit | Consumer artifacts and regenerated callers |
| B1-02, B1-04, B1-05 | Outcome vocabulary, typed metadata, causes and programmatic/transport/managed completion tests | Installed dispatcher limitations described above; consumer classification/retry handling |
| B2-01, B2-07, B2-10 | One managed owner, raw SQL participation, unsupported owner rejection; packed success/rollback examples | Consumer transaction helpers and callers |
| B4-02, B4-07 | Selected propagation policy, read/write-response failures, HTTP parity and transaction evidence | Consumer failed-response handling |

That full checkpoint passed 12,973 tests with zero failures and one
existing skip. Types, package contents, query budgets, lint and docs passed too.
See the [checkpoint record](verification-progress.md#2026-09-11-library-only-part-b-pause-checkpoint)
and [local migration reconciliation](local-api-migration.md#library-only-pause-acceptance-2026-09-11).
That was the requested stopping point with named exceptions, not a claim that
all Part B acceptance, remaining Part A work or the full goal is complete.

## Original library-first split, historical

At this split, 137 items were complete and 77 remained open. Thirty-four open items
outside Part M and final review explicitly mix consumer work with library work.
The table identifies the library acceptance to establish and the external work
that prevents closing each whole item. It is not a claim that every listed
library activity is still unimplemented: existing evidence must be reconciled
before making changes or repeating checks. Do not replace working code merely
to give an open item a new implementation.

| Item | Library acceptance to establish or finish here | External work remaining |
| --- | --- | --- |
| A4-01 | Hook order, nested response reads and smallest justified context contract | Confirm actual downstream hook consumers |
| A4-04 | Verify IDs, attributes, results, operation/auth context and transaction identity | Port removed or changed context fields |
| A4-08 | Accept POST ID, trace, failure and response behavior | Port POST consumers |
| A4-10 | Accept PUT create/replacement and omitted-relationship semantics | Port changed PUT behavior |
| A4-12 | Review shared response preparation, finish hooks and obsolete response branches | Verify callers use the selected options |
| A4-13 | Verify normalization after every retained response-mutating hook | Verify migrated downstream temporal handling |
| A4-16 | Remove unused library branches, imports and context views with local caller evidence | Refresh all external callers before deletion acceptance |
| A4-18 | Compare library conformance and real connector traces with the selected lifecycle | Execute affected consumer workflows |
| A5-06 | Specify and test JSON, validation, storage and output value boundaries | Port consumer declarations and transformations |
| A5-10 | Accept earliest valid configuration rejection and forward-reference behavior | Reconcile actual late-customization callers |
| A5-11 | Audit library metadata derivation and remove demonstrated redundancy | Port hook-accessible schema consumers |
| A6-09 | Inventory and test actual library query operations and deliberate removals | Inventory and port external query usage |
| A6-10 | Review direct storage calls and remaining proxy behavior for demonstrated need | Port external query hooks |
| A6-16 | Execute library raw-query/custom-hook examples on their supported backends | Execute actual consumer queries |
| A7-01 | Finish transaction-state and ownership specification and verification | Reconcile ownership across consumer helpers |
| A7-07 | Prove borrowed transactions are never completed by participants | Port callers and side-effect handling |
| A8-04 | Measure and resolve justified remaining bulk/reverse-write fetch bottlenecks | Reconcile downstream hook contracts |
| A8-12 | Record measured library costs and before/after results | Record consumer regressions |
| A9-09 | Accept published declarations against the selected library surface and packed fixtures | Type-check actual consumers |
| A10-08 | Audit library imports, removed paths and optional-peer loading | Refresh external deep imports and generated callers |
| A10-09 | Verify actual packed artifact, temporary installation, plugins and declarations | Verify paired consumer installations |
| A10-10 | Verify clean Node 24 installation and scoped dependency changes | Verify migrated consumer installations and locks |
| B0-07 | Accept explicit connector format/returning behavior and request/CORS contracts | Port HTTP/client/assistant consumers |
| B0-09 | Keep the selected API and migration instructions ready for direct adoption | Port and verify downstream callers and generators |
| B0-11 | Prove direct library behavior needed to replace identified workarounds | Audit and remove actual consumer wrappers |
| B0-12 | Execute packaged library migration examples and search local obsolete API paths | Verify paired examples, regeneration and external legacy searches |
| B1-02 | Verify machine-readable outcome/error fields and original causes | Port downstream error classification |
| B1-04 | Verify acknowledged-commit failure contract, including dispatcher limitation | Consume dependency fix and port retry/error handling |
| B1-05 | Accept outcome metadata in programmatic, HTTP, bulk and Socket.IO boundaries | Update real consumer handling and status tests |
| B2-01 | Document and verify one selected library ownership mechanism | Reconcile the existing consumer transaction helper |
| B2-07 | Accept retained raw SQL participation and rejection of unsupported ownership modes | Port affected raw-transaction callers |
| B2-10 | Keep imports, types and successful/rollback migration examples executable | Port transaction helpers and remove overlapping wrappers |
| B4-02 | Accept the selected unexpected-failure propagation contract | Port callers relying on partial success |
| B4-07 | Verify HTTP/programmatic parity, policy precedence and transaction outcomes | Verify downstream failed-response handling |

Seventeen further items open at that time had no explicit consumer migration
in their own text: A5-02/03/12, A7-04/05/06, A9-02/03/04/05/07/08,
A10-01/02/03 and B0-01/08. These are not seventeen uniformly sized changes.
At that time, some whole-API A7 guarantees depended on the installed hooked-api
dispatcher; the tested patch was retained in
[pending-hooked-api](pending-hooked-api/README.md), not installed or published.
The later local runtime replacement superseded that dependency blocker.

Part M has twelve open items. Its migration guide, decision rationale and local
artifact preparation can still improve here; current consumer inventories,
ports, generators and paired verification remain paused. The fourteen final
review/report items also contain useful library review work, but final
cross-repository acceptance cannot be claimed from library-only checks.

The instruction at that checkpoint was to record completed library portions
with exact evidence in the [work ledger](verification-progress.md). Leave the parent checkbox open while
consumer or dependency acceptance is missing. Once no independent authorized
library work remains, report that boundary and pause; do not start another
repository or mark the full execution goal complete.
