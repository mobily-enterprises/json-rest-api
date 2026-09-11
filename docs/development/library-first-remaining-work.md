# Library-first remaining work

The maintainer requests completing as much as possible in json-rest-api before
moving to other software, then pausing. Do not modify jskit-ai, vibe64, their
seeds, or upstream dependencies under this phase. Positioning work remains
paused separately. The [master plan](../../library-improvement-plan.md) remains
the authoritative 214-item checklist; this is a work split, not a new denominator.

**Latest update:** B0-01's [library call-convention inventory](resource-call-inventory.md)
is complete. The master count is now **138/214, 76 open**; the original split
below remains historical. Its seventeen-item library list now has sixteen open
items, with B0-01 removed. The 34 mixed items remain open.

## Requested Part B pause point

The maintainer explicitly confirmed the latest instruction: pause after the
library-only portion of Part B, before a separate broad cleanup and commit/push.
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

Twelve of the thirteen open items explicitly include consumer acceptance.
B0-08 is the library-only exception: dynamic-call evidence is now reconciled;
the explicitly paused positioning HTTP example remains.
Passing the library test suite does not close the consumer portions.

B1's remaining guarantees also depend on the parked hooked-api fixes. A read-only
npm registry check on 2026-09-11 still reports version 1.0.24; no newer published
release was available to replace the installed dependency. The retained patch
has not been installed or published. See the
[dependency evidence](pending-hooked-api/README.md) and
[local API migration audit](local-api-migration.md).

## Library-only Part B acceptance at pause

Work is now paused at the requested boundary. The 13 open Part B checkboxes are
retained; this table records their independently actionable library portions.

| Open items | Library evidence accepted here | Still deferred |
| --- | --- | --- |
| B0-07 | Explicit connector format/return controls; full HTTP, CORS, bulk and Express 4 checks | Consumer transport/client migration |
| B0-08 | Local named/dynamic call reconciliation; full tests, declarations and executed examples | Paused positioning HTTP example |
| B0-09, B0-11 | Selected API/migration map and direct temporal/fieldset/error contracts tested | Actual consumer ports and wrapper removal |
| B0-12 | Selected migration After snippets executed against the packed library; local legacy audit | Consumer artifacts and regenerated callers |
| B1-02, B1-04, B1-05 | Outcome vocabulary, typed metadata, causes and programmatic/transport/managed completion tests | Installed dispatcher limitations described above; consumer classification/retry handling |
| B2-01, B2-07, B2-10 | One managed owner, raw SQL participation, unsupported owner rejection; packed success/rollback examples | Consumer transaction helpers and callers |
| B4-02, B4-07 | Selected propagation policy, read/write-response failures, HTTP parity and transaction evidence | Consumer failed-response handling |

The current full checkpoint passes 12,973 tests with zero failures and one
existing skip. Types, package contents, query budgets, lint and docs pass too.
See the [checkpoint record](verification-progress.md#2026-09-11-library-only-part-b-pause-checkpoint)
and [local migration reconciliation](local-api-migration.md#library-only-pause-acceptance-2026-09-11).
This is the requested stopping point with named exceptions, not a claim that
all Part B acceptance, remaining Part A work or the full goal is complete.

## Original library-first split

At this split, 137 items are complete and 77 remain open. Thirty-four open items
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

Seventeen further open items have no explicit consumer migration in their own
text: A5-02/03/12, A7-04/05/06, A9-02/03/04/05/07/08,
A10-01/02/03 and B0-01/08. These are not seventeen uniformly sized changes.
In particular, some whole-API A7 guarantees depend on the installed hooked-api
dispatcher; the tested patch is retained in
[pending-hooked-api](pending-hooked-api/README.md), not installed or published.
Finish independently verifiable library work without claiming that patch is
already part of the running dependency.

Part M has twelve open items. Its migration guide, decision rationale and local
artifact preparation can still improve here; current consumer inventories,
ports, generators and paired verification remain paused. The fourteen final
review/report items also contain useful library review work, but final
cross-repository acceptance cannot be claimed from library-only checks.

Record completed library portions with exact evidence in the
[work ledger](verification-progress.md). Leave the parent checkbox open while
consumer or dependency acceptance is missing. Once no independent authorized
library work remains, report that boundary and pause; do not start another
repository or mark the full execution goal complete.
