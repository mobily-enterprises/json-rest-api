# Current v2 migration preparation

## Follow-up rollout and local cleanup, 2026-09-13

After the completed scope below, the user requested source pushes (including
the official seed branches), hosted Vibe64/Online deployment when requested,
and migration of `sas/compas-next`, `sas/racing`, `sas/dogandgroom`,
`matt/beepollen` and `pass/whs2`. That follow-up goal is incomplete. The historical
250/250 count below does not claim completion of these additional projects.

The subsequent “Actually wait” request prompted a focused local deslop. The user
then explicitly resumed pushes and migrations, followed by “I want you to push
and publish everything first.” Source delivery and npm releases now take
priority; the five application migrations wait for that publication phase.
Hosted deployment remains subject to the separate explicit deployment request.
The reviewed cleanup consists of:

- Vibe64's file-sync test uses an ordinary active ref instead of extracting and
  executing template expressions. It preserves ref/getter inputs, close/reopen,
  stale-event and disposal checks. Parent/child binding assertions are explicitly
  source checks, not mounted integration tests. No new test renderer or compiler
  remains; the file is ten lines shorter.
- The accounts seed's persistence test names request results and expands dense
  payloads. Request/assertion order, database guards, restart, isolation and
  cleanup are preserved.
- JSKIT's `connectors-web` package explicitly publishes `src`. The package check
  retains both runtime files, README and manifest, excluding six test/fixture
  files and the generated Playwright result. Published `0.1.3` is unchanged;
  applying this packaging policy to npm requires a future version.

Focused checks: Vibe64 Node 26.5.0 **3/3 pass**; accounts Node 26.5.0 syntax/lint
pass and real MySQL persistence **1/1 pass**; JSKIT Node 24.6.0 package dry-run
confirms all four required files. The accounts test runner's outer cleanup
initially rejected a process transitioning through shutdown; a subsequent
ownership check confirmed it stopped, and the disposable database directory is
absent. The test was not rerun for that observation race. Independent review
found no account-sequencing or package-runtime omissions.

The library pre-push test already running when the user requested the deslop
finished with **6,272 passes, zero failures and one canonical-only skip**. No new
library suite was started for this cleanup, and no production runtime changed.
Local evidence is retained under
`/home/merc/.cache/json-rest-api-canonical-rollout-20260913/`.

Registry preflight found `json-rest-api@1.0.29` still tagged `latest`; the first
published JSKIT cohort uses the immutable v2 Git commit. The publication phase
will release the current `json-rest-api@2.0.0`, then prepare one new coordinated
JSKIT cohort using exact npm `2.0.0` and the reviewed package whitelist. Existing
published versions remain immutable. Consumer pins will follow the published
cohort through the supported updater; no application runtime migration starts
before this phase finishes.

## Completed rollout, 2026-09-13

**The scoped master plan is complete: 250/250 items, zero open.** The 40 prepared
JSKIT packages are published to public npm. Canonical local Vibe64 and both seed
branches use genuine registry dependencies/locks, pass fresh-install acceptance,
and are committed. Library and JSKIT checks use Node 24.6.0; application checks
use Node 26.5.0, with the apps' existing Node 26 engines retained.

The user explicitly authorized publication with “Publish them!” and then
“Then continue and finish everything off.” This supersedes the earlier npm
publication boundary. No new version-preparation pass or extra release cohort
was introduced. Source commits below are local; no Git branch was pushed and
no application was deployed. The five other canonical application ports remain
owner-managed. Those exclusions are the existing agreed scope, not unfinished
library or selected-consumer implementation.

### Result and source identity

The library retains its SQL/storage/schema implementation behind the small
direct runtime. Application writes use `data` or explicit JSON:API `document`,
with independent `format`/`returning`; mutable hooks share deliberate operation
context. Managed transactions preserve failure/commit ownership through nested
operations and client error mapping. JSKIT's host and repositories implement
that contract without the old input-builder/response-repair layers.

This final batch publishes that implementation and connects actual consumers.
Vibe64 needs dependency and stale test-fixture changes, not production operation
rewrites. Both seeds gain the required project-owned Resource estimates; accounts
also gains the reviewed real-database persistence/isolation CI check. Existing
accounts edits and Vibe64 integration work were preserved. No unrelated
third-party dependency versions changed.

| Source | Accepted identity |
| --- | --- |
| JSON REST library | Version `2.0.0`, immutable Git `f97dc859321aee41915f3b0e256a861c382bc1b3`; all 173 installed files match. No new json-rest-api npm publication. |
| JSKIT | `e52ce97f921e471ceaaa6ce4dcdc62aa0b09d077`; 40 npm versions including catalog `0.1.211`, host `0.1.130`, CRUD `0.1.197` and kernel `0.1.186` |
| Vibe64 main | `777a6b1acf37d47326a665a8b3a8836c6551b278`; 14 root and 23 workspace JSKIT pins across twelve manifests |
| Public seed | `25d34e282fd571e2b1b44104d20b2d36b58828fe`; five root pins plus workspace kernel |
| Accounts seed | `f1617363e3e4e3180612cb1dd53eaaa120c3777d`; ten root pins plus workspace kernel; JSON REST v2 installed through the shared host |

All 40 actual registry artifacts were downloaded and inspected. Thirty-nine
archives are byte-identical to the prepared tarballs. `connectors-web@0.1.3`
accidentally also contains the 45-byte Playwright file
`test-results/.last-run.json` (`status: passed`, no failed tests). Every one of
its ten prepared files, including its manifest and runtime, is unchanged.
This is a packaging blemish, not an application-code difference. The actual
published integrity is recorded and used in locks; it is not falsely labelled
the original tarball. Across the release, all 2,161 prepared files match and
there are 2,162 published files including that single reviewed extra.

### Combined verification

Existing broad results are reused only for matching implementation bytes.
No whole-library or JSKIT suite was repeated for publication, dependency locks,
archived prose or commits. The final fresh registry checks execute the installed
packages on the agreed application runtime.

| Gate | Actual result and scope |
| --- | --- |
| Library Node 24 | 6,272 ordinary SQLite, 6,322 canonical SQLite, Express 4 542 + 544 passes: 13,680 passing executions, not unique tests. One ordinary canonical-only fixture skips there and passes in canonical mode. Types, packed declarations, budgets, lint and docs pass. |
| Final affected native library checks | PostgreSQL ordinary/canonical 199 + 199; MySQL 203 + 203: 804 passes. This final selection is not a new full native matrix; earlier scoped database/Redis evidence remains recorded below. |
| JSKIT Node 24 | Broad checkpoint: 2,783 passes, one documentation-size failure and nine conditional skips out of 2,793. The documentation fix has 19 focused passes; conditional/native/browser acceptance is recorded separately below. Do not relabel the original broad command as exit zero. |
| Prepared selected apps | Both full seed verify commands pass. Public/accounts browsers pass 9/4; accounts original-v1 persistence, retained-data v2 upgrade, fresh v2 persistence and real Vibe64-created app persistence pass. Real candidate creation succeeds for both seeds. |
| Vibe64 staged broad acceptance | Server: 2,135 passes, two stale assertions corrected with 57 affected passes, one optional host skip. Client: 1,119 initial passes with seven failed assertions and one suite-load failure; all eight affected files then pass 44 checks on Node 26. Build, fifteen boundaries, affected lint, two browser cases and packed-app startup pass. |
| Final public registry installs | Fresh `npm ci` and graph checks pass in all three copies. Public smoke 1/1, accounts smoke 1/1 and real persistence 1/1, Vibe64 smoke 7/7; no failures or skips in these ten checks. Both seed builds and fifteen Vibe64 package boundaries pass. |
| Final installed bytes | Public 5 JSKIT packages/356 files; accounts 21/853; Vibe64 16/1,413 including the documented extra file. Canonical and fresh-copy locks match. No hooked-api, temporary registry URL, private/linked/duplicate JSKIT installation remains in these source-consumer graphs. |
| Documentation and review | Three literal migration examples execute eight check groups against actual MySQL/packed packages; guide hash remains unchanged. Final interaction, simplicity, removed-caller, seed/source, dependency and cost reviews complete. |

The fresh accounts persistence check uses a new owned MySQL 8.0.46 database,
prepares twice, recreates the HTTP server within one Node process, verifies login
and retained profiles, rejects anonymous/wrong-password access and isolates two
users. It is not an OS crash/reboot test. Its database was dropped and the owned
MySQL process stopped. The earlier upgrade rehearsal separately exercises v1
and v2 installed applications in different Node invocations against retained data.

The first final Vibe64 updater attempt encountered a full `/tmp` filesystem;
npm presented the failed metadata write as an `ERESOLVE` conflict. The updater
restored every manifest/lock and existing fixture. After deleting only inactive
owned rehearsal dependency directories, the normal update and clean install
passed without force/legacy-peer flags. Failed logs and rollback proof remain.
All accepted source, locks, artifacts and logs were retained; cache cleanup and
service shutdown are recorded. No new headless browser was started in this
publication turn; no owned tests or application/database servers remain running.

### Limits and migration handoff

The sole optional Vibe64 systemd/cgroup workflow-owner proof remains unexecuted;
existing lint/chunk-size warnings remain. The packed Vibe64 distribution has
pre-existing same-version bundled/outer kernel and connectors-core copies; its
reviewed class ownership works in the exercised paths, but it is not a globally
deduplicated distribution. The fresh source-consumer graphs above are deduplicated.

All 88 library query measurements meet their ceilings. Sparse/related-author
reads improve; some flat/nested shapes grow. Actual accounts SQL counts remain
20/8/49/18 for registration/login/write/read. Small concurrent timing/memory
samples and missing A0 startup data support no universal speedup claim. See the
[recorded comparison](../query-measurements.md#final-cost-comparison-against-a0-2026-09-13-c2-03).

Official remote seed branches and hosted applications have not been updated by
this rollout. Actual Genesis creation was verified from the accepted local
candidate templates; the canonical local branches now contain the portable
published dependencies and commits above. Git pushes and Online deployment are
separate from the approved npm publication. The maintainer's later ports of
`sas/compas-next`, `sas/racing`, `sas/dogandgroom`, `matt/beepollen` and `pass/whs2`
are mapped in [the usage inventory](../../../consumer-migration-feature-usage.md)
and [GUIDE 33](../../../../docs/GUIDE/33-migrating-to-v2.md), including composed
repositories, whole-owner duplicate retries and application upload compensation.

The adjacent manifest's `currentRollout.publication`, `registryAcceptance` and
`finalSourceState` contain all versions/integrities, commands, counts, source
hashes and evidence paths. Temporary raw evidence lives at
`/tmp/jskit-v2-rollout-42tSXQ`; this report preserves the findings independently
of those disposable files. Historical statuses below describe earlier stages
and are superseded by this completed result.

## Active Vibe64 and seed rollout, 2026-09-13

The new goal authorizes completing Vibe64, the catalog-selected public/accounts
seeds, coordinated package rollout and combined verification/final review.
Earlier pause statements below are historical. After inventory, behavior and
installed-artifact reconciliation, the master is **236/250 complete (94.4%); 14 open**.
Local candidate acceptance and four final reviews are complete; portable rollout
and final combined reconciliation remain pending.

**Historical publication blocker, now resolved by user approval:** after three consecutive goal turns encountering the
same missing publication approval, the prepared source hashes and canonical
locks were rechecked unchanged. The preceding turn completed four independent
review items; no further independent implementation or verification is needed
before this boundary. The goal was blocked pending the user's publication
decision. The user subsequently approved “Publish them!” and instructed
continuing to finish the rollout. A status request or automatic continuation supplies no
publication approval. On resumption, recheck the prepared graph and registry
availability, then follow the publication handoff below; do not prepare another
version graph or repeat unchanged full suites.

The user confirmed that app checks use **Node 26** with their current engines;
library and JSKIT checks remain on **Node 24**. Use focused checks during changes
and reserve broad verification for the combined checkpoint. Serialize Vibe64
test runs through its documented commands.

Fresh read-only inventory:

| Source | Starting revision | Working tree before rollout |
| --- | --- | --- |
| json-rest-api | `484d545` | Clean; accepted runtime is `f97dc859321aee41915f3b0e256a861c382bc1b3` |
| jskit-ai | `ba6b49252baead0cce791b3ceb39d04c13feb48b` | Clean; accepted source migration, not published |
| Vibe64 main | `c14eb989d4e54785fa55f5c863830257f932d977` | Clean |
| seed-jskit public | `02cf10cef15a2a44b73adf52e5cd60e53b7bf9bf` | Clean |
| seed-jskit accounts | `91dad8e418ada6594001b8282c2b87c41e8fc3e5` | Existing README/package edits and untracked account persistence integration test; preserve and review |

Vibe64's public Genesis boundary selects `genesis-stack@1.1.2`. Its static
template catalog selects `official:jskit/public` and `official:jskit/accounts`
from the public/accounts branches of `vibe64-dev/seed-jskit`. Remote branch
checks matched the seed revisions above. These are branch selections, not
catalog-pinned commits.

No direct JSON REST operation, context/hook, transaction or removed-option
callers were found in Vibe64 or either seed's authored source. Vibe64 and the
public seed have no installed JSON REST host. The accounts seed reaches v1
through users-core and json-rest-api-core. Required work is the coordinated
package graph and proof of the actual host/account workflows; do not invent
application adapters or an ORM rewrite where there are no callers.

Published JSKIT versions currently identify the old implementation, including
json-rest-api-core `0.1.129` using json-rest-api `^1.0.29`. The migrated source
must receive new versions through the existing coordinated release preparation.
Prepare and pack that graph, then rehearse disposable consumers with those real
artifacts. Such a rehearsal does not establish registry-install acceptance.
Do not commit temporary tarball paths or fabricate registry lock metadata.
Seek publication approval only once the exact release and checks are reviewable;
then complete genuine portable locks and fresh-install checks. Online deployment
and changes to deployed application data remain outside this batch.

The user reconfirmed the five canonical applications: `sas/compas-next`,
`sas/racing`, `sas/dogandgroom`, `matt/beepollen`, and `pass/whs2`. Refresh their
read-only migration-impact inventory and document required ports. Their actual
code/data migrations remain owner-managed, separately from Vibe64 and its seeds.
The earlier [schema-helper audit](../../../consumer-migration-feature-usage.md)
is evidence about migration-helper usage, not a completed v2 caller migration.

### Artifact acceptance in progress

The existing JSKIT preparation command ran **once**, producing catalog
`0.1.211` and 40 coordinated package versions. Do not repeat it when resuming:
each execution bumps versions again. All eight release-coordination tests pass;
the lock comparison found no unrelated third-party version changes.

Packed review found one pre-existing dangling database-runtime export,
`./shared/runtime`, whose implementation was deleted in August. It has no
current local or canonical-app callers. The export was removed, catalog/docs
rebuilt and all artifacts repacked. The final audit covers 40 packages, 2,161
matching source files and 431 valid export targets. The generic `npm pack
--workspaces` command initially included an unversioned internal test utility;
the successful pack explicitly selected the 40 publishable JSKIT workspaces.

Artifacts, disposable consumer copies and evidence live in
`/tmp/jskit-v2-rollout-42tSXQ`. The temporary registry serves actual verified
tarballs read-only on loopback; its current URL/PID is in `registry.json`.
`mysql.json` describes the owned Oracle MySQL 8 fixture; `stop-mysql.mjs` verifies
process ownership before shutdown. Both services are now stopped, with inactive
files retained for provenance and review. Their registry locks must not be copied
into canonical repositories.

Focused Node 26 checks pass against the actual artifacts: public seed startup
1; Vibe64 server 7, real Socket.IO handshake 1 and client commands/retry 50.
Byte verification matches all installed JSKIT files in public (5 packages/356
files) and Vibe64 (16 packages/1,412 files). Neither installs the JSON REST host.

The accounts test now verifies the explicit test database before migration,
prepares twice, restarts its server and checks persisted/isolated profiles. It
passes on the original v1 graph and a fresh v2 database. The same v1 database
was retained across the artifact upgrade: both original accounts still log in
and return their saved profiles under v2, and neither preparation invocation
adds migrations. The test is also wired into the existing disposable CI database
job; its direct Knex test import is declared as a development dependency.

Both seeds now pass their full `npm run verify` checks on Node 26, including
lint, server/client tests and production builds. Their existing browser suites
also pass against owned real servers: public 9/9 and accounts 4/4. The accounts
before/after workload retains exactly the same SQL statement counts for
registration (20), login (8), profile writes (49) and settings reads (18).
Its ten measured write/read rounds retain the same final profile and migration
history. Timing and memory samples ran alongside other acceptance work and do
not establish a speed improvement or regression.

Vibe64's broad server stage completed with 2,135 passes, two stale integration
test assertions and one optional skip, out of 2,138 tests. The two assertions
now reflect the actual 40 routes and explicit resume-integration action; both
affected files pass (2 and 55 tests). The sole skip needs a configured systemd
workflow owner and cgroup host facilities; it does not exercise the package
migration. The complete server suite was not repeated for those isolated fixes.
The subsequent full client run reports 1,119 passes, seven failed assertions
and one suite-load failure (108 files, 1,126 tests). All eight affected files
now pass 44 focused checks on Node 26.5.0. Seven fixtures were stale after the
Files/Subsystems/Integrations changes; the dense ERD check passed alone with its
existing timeout unchanged. An incidental first focused run used Node 24 and
was explicitly repeated on the agreed Node 26 runtime. The production build,
all 15 package-boundary checks and affected lint pass. Existing lint/chunk-size
warnings are retained. Do not claim the broad commands exited successfully;
this is staged acceptance after focused corrections.

Vibe64's two existing browser smoke/recovery cases pass on Node 26. The first
attempt exposed a missing assistant-capabilities entry in their strict Studio
API fixture. Its current empty/unavailable catalog response restores that
fixture without bypassing unknown requests. These two tests exercise the real
built client with mocked Studio API responses; the accounts browser/database
checks above use actual application responses. The persistence test closes and
recreates the HTTP server within one test process; it is not a process-crash or
host-reboot simulation. The separate v1-to-v2 upgrade rehearsal runs the different
installed application graphs in separate Node invocations against retained data.

The real Vibe64/Genesis fresh-project rehearsal found that the selected seeds
lacked the current stack's required project-owned Resource estimates contract.
Both seed Stacks now include the actual app output and workspace setup, with
README notes explaining initial unmeasured development planning hints and the
accounts shared-database exclusion. Actual candidate creation now passes for
both: real Vibe64 project service and Genesis import, new-to-ready transition,
exact source snapshots, preserved destination HEAD/origin/collaboration and
rejected repeat application. Fresh install, package-graph checks, build, and
health/home/bootstrap HTTP checks pass for each imported application. The newly
created accounts app also passes its database persistence/restart/isolation test.
Its owned database and both HTTP servers were cleaned up. Local candidate Git
snapshots prove the prepared templates; official remote branches remain unchanged.

Detailed identities, counts and logs are in the manifest's `currentRollout`
entry. The original parked patch and accepted JSKIT migration evidence remain
unchanged. Published-registry lock/install acceptance is still pending.


### Implementation report before registry rollout

The library's internal changes replace the external hooked-api dispatcher with
an ordinary resource/plugin/hook runtime, currently 172 lines. JSON:API operations,
SQL storage, schema compilation and transaction management remain in their own
implementation modules. The small runtime connects them; it does not implement
an ORM in 172 lines. Shared compiled metadata, explicit storage/relationship
boundaries, permission-aware includes, typed IDs/temporal values and tested failure
ownership make behavior more consistent without introducing another generic
framework. Native-driver conformance, meaningful query budgets, executable guide
examples and packed declaration checks provide continuing regression coverage.
See the maintained [architecture](../../../../docs/architecture.md).

The public surface remains resource-oriented. Its deliberate breaking changes
are `JsonRestApi`/`api.resources` setup; plain `data` or explicit JSON:API
`document` input; independent output `format` and write `returning`; and managed
transaction ownership with machine-readable failure outcomes. Hooks still share
mutable operation context for caches, extra information and allowed field changes.
Caller visibility, nested inheritance and library-owned fields are explicit.
Old options are rejected rather than translated through a compatibility layer.
Optional version checks and improved schema inference are available where an
application needs them. The mock S3 adapter is removed; SQL focus and reviewed
schema-helper responsibilities remain. GUIDE 33 is the complete
[API migration reference](../../../../docs/GUIDE/33-migrating-to-v2.md).

The accepted JSKIT source migration moves its host and shared repositories onto
that contract while retaining useful domain mappings, document methods and native
queries inside managed owners. Response repair, old input builders and overlapping
completion helpers are removed. HTTP/client error mapping preserves outcomes and
prevents automatic replay of committed or uncertain writes. Its current 40-package
release preparation gives that implementation a coordinated distributable graph.
Vibe64 and the selected seeds introduce no additional direct library callers;
their work is package rollout and actual workflow acceptance. The new seed resource
contracts and repaired Vibe64 fixtures address concrete problems found during that
acceptance, without changing Vibe64 production logic.

Exact executed checks, source/package identities and remaining limitations are in
the handoff below and adjacent manifest. The five separately owned canonical apps
have a read-only impact inventory and concrete migration examples, including
whole-owner retries and upload compensation. Their ports have not been performed.
The local candidate results do not establish published-registry installation,
updated official seed branches, hosted deployment or production-scale adoption.
Those distinctions remain explicit while publication approval is pending.

### Final candidate review, 2026-09-13

Independent read-only reviews complete C1-03, C1-05, C1-06 and C2-03 for the
selected candidate source and prepared artifacts. No tests, benchmarks, installs
or services were repeated for these reviews. Publication and canonical portable
locks remain separate open acceptance conditions.

Fresh byte comparisons confirm all 2,161 JSKIT packed files, the 131 library
runtime/declaration/manifest files and 46 accepted JSKIT migration source/test
paths still match their evidence. The current changed-file snapshots also match:
JSKIT 105, Vibe64 11, public seed 2, accounts seed 6. The earlier broad JSKIT
snapshot differs in one later native repository test; its seven current cases
have their own recorded MySQL/PostgreSQL acceptance. The current migration guide
and its three literal examples match their executed hashes.

The adversarial pass traces malformed inputs, nulls, sparse authorized reads,
custom IDs, serializers, projected cursors, temporal values, empty/cyclic
relationships, mutable hook contexts and concurrent transaction failures to
assertions in the unchanged accepted library suites. Shared JSKIT owners reject
raw write owners/savepoints, retain failed-participant state even if caught,
preserve committed/uncertain outcomes and limit duplicate recovery to acknowledged
rollback. Actual accounts persistence, v1-to-v2 upgrade, isolation and browser
checks agree with those contracts. Guide checks include real whole-owner SQL
retries and application file compensation; injected uncertain outcomes remain
explicitly distinct from actual network faults. No new concrete regression was
found. This is bounded review, not every possible hook policy, OS crash recovery
or a repeated full native matrix.

The simplicity pass follows ordinary runtime functions, schema compilation,
normalization, weak transaction/context registries, cleanup and shared repository
delegation. There is one private recursive plain-record normalizer, reusing the
attribute normalizer and a per-call WeakMap. Shape conversion has a separate
responsibility. Completed owners clear participants, finalizers, active work and
query listeners; schema caches have explicit resource or bounded type ownership.
No new compatibility framework or concrete stale-state defect was found.
Existing small users/workspaces JSON utility duplication and the unchanged
deferred authentication proxy remain; neither is a replacement hooked-api layer.
The packed Vibe64 duplicate-package ownership limits below also remain explicit.

Removed-module/helper searches cover 158 maintained library source/configuration
files, 1,383 JSKIT files, 531 Vibe64 files and 38/44 public/accounts seed files.
No selected runtime callers remain for the removed S3 adapter, input builder,
query adapter, normalization helpers or dead database-runtime export. Retained
internal hook names and rejection declarations are intentional. Reviewed actual
packed declarations/exports establish the prepared publication surface; this
does not claim a registry publication. The canonical accounts lock still has
four textual hooked-api occurrences pending its portable graph update. Known
old callers in the five canonical apps remain documented owner-managed ports.

The [final cost comparison](../query-measurements.md#final-cost-comparison-against-a0-2026-09-13-c2-03)
records all 88 current SQL-budget measurements, initialization evidence and exact
package contents against A0. Sparse and related-author query counts decrease;
flat and some nested counts increase. Accounts SQL remains 20/8/49/18. Its actual
Fastify request injection uses real MySQL but excludes network transport. Small
concurrent timing samples establish no speedup. A0 has no whole-library startup
baseline. The exact f97 artifact is 21.75% smaller packed and 34.67% smaller
unpacked, partly because development files are excluded; these are not claims
about executable-code shrinkage or the later unpublished guide additions.

Full review notes are retained under `/tmp/jskit-v2-rollout-42tSXQ` as
`final-interaction-review.md`, `final-simplicity-review.md` and
`final-cost-comparison.md`; their hashes and acceptance limits are recorded in
the adjacent manifest. This section and the measurement ledger preserve the
findings if temporary files are later removed. Final source/dependency checks
must still reconcile the canonical graphs after approved publication.

### Publication handoff

The local candidate release is ready for approval. This is a readiness record,
not a claim that the canonical app dependencies or public registry are migrated.

| Area | Accepted result |
| --- | --- |
| Runtime policy | Library/JSKIT Node 24.6.0; apps Node 26.5.0, existing `26.x` engines preserved |
| JSKIT release | Existing preparation ran once; 40 coordinated versions, catalog `0.1.211`, host `0.1.130`; 40 publish dry runs pass |
| Library identity | Both JSKIT runtime importers retain immutable v2 Git revision `f97dc859321aee41915f3b0e256a861c382bc1b3`; no new library runtime change |
| Package audit | 40 tarballs, 2,161 matching files, 431 valid export targets; no unrelated third-party version changes |
| Accounts | Original v1 persistence, retained-data upgrade to v2, fresh v2 persistence and newly created v2 app persistence all pass; repeated preparation adds no migrations to the upgraded database |
| Seeds | Both full verify commands pass; public browser 9, accounts browser 4; both real Vibe64/Genesis candidate creation workflows pass |
| Vibe64 source | Broad server 2,135 passes, two stale assertions, one optional host skip; corrected files pass 57. Broad client 1,119 passes/seven failed tests/one load failure; all affected files then pass 44 on Node 26. Build, package boundaries and affected lint pass |
| Vibe64 browser | Two smoke/recovery cases pass after updating the strict assistant-catalog fixture |
| Vibe64 distribution | Existing pack/install smoke passes. The actual fresh installed server returns health, app HTML and built JavaScript successfully; owned server closed |
| Cost comparison | Accounts SQL counts unchanged at registration/login/write/read 20/8/49/18; equal persisted data/migration history. Concurrent timing observations establish no speed change |
| Cleanup | All owned browser/application servers, MySQL and loopback registry stopped; inactive artifacts/evidence retained |

The packed Vibe64 application contains thirteen unique JSKIT packages in fifteen
installations; all 1,187 installed files match their intended artifacts. Kernel
and connectors-core have bundled/outer copies with identical versions and bytes.
The published `vibe64@0.1.26` artifact already has this arrangement. Independent
resolver/source review found no class-identity crossing in the actual paths used
here, so no speculative packaging rewrite was made. The detailed topology review
is `/tmp/jskit-v2-rollout-42tSXQ/packed-topology-review.md`.

New canonical changes prepared in this goal are the coordinated JSKIT release
metadata/generated references and dead-export removal; eleven Vibe64 test-fixture
files; each seed's Resource estimates and README; and the reviewed accounts
persistence test, direct test dependency and existing database CI integration.
The accounts work already present at goal start was preserved. The library adds
migration examples and the five canonical apps' read-only impact inventory.
Vibe64 production source and Online remain unchanged. Exact changed-file hashes,
starting revisions, complete versions, integrity values and proposed dependency
changes are recorded in `currentRollout` in the adjacent manifest.

No library or JSKIT whole-suite repeat is required for these unchanged executable
artifacts. The earlier accepted library/JSKIT gates and current source-to-packed
byte verification are part of this combined evidence. Broad Vibe64 failures are
retained alongside their successful focused corrections; they are not relabelled
as successful broad command exits. The single optional systemd/cgroup proof was
not exercised and remains an explicit coverage limitation.

Next, with publication approval, run **only** `npm run release:npm:publish`
in JSKIT on Node 24 against the reviewed source. Do not run `npm run release` or
repeat `release:npm:prepare`: those prepare and bump another graph. Publish the
40 prepared JSKIT versions, retaining the accepted immutable library Git pin.
This action does not publish json-rest-api or Vibe64 itself, push the seeds, or
deploy Online. All forty intended versions were absent from public npm at the
recorded availability check; recheck source hashes and availability before the
actual irreversible step.

After successful publication, use the prepared catalog update in canonical
Vibe64/public/accounts, generating real registry dependencies and locks. The
expected root JSKIT pin changes are 14, 5 and 10 respectively. Inspect the exact
resolved graph, perform clean installs and focused real workflow checks, then
finish the final source review/report. Never copy the temporary registry URLs
into canonical locks or manufacture npm integrity/resolution data.

Remaining fourteen master items are M-10/M-14, R-A10-10/R-B0-09,
C1-01/C1-02/C1-04/C1-07 and C2-01/C2-02/C2-04/C2-05/C2-06/C2-07. Other canonical app ports remain the owner's
separate work; their guide is ready. M-14 explicitly excludes remote publication
from the earlier authorized scope, so publication is the next approval boundary.

## Accepted jskit-ai migration, 2026-09-13

The current jskit-ai source migration is complete and verified. Its clean starting
main revision was `dff33b4f7ceb2253baa96d84e602464dbd4f83a5`. The user then
requested committing all changes; jskit-ai is committed as
`ba6b49252baead0cce791b3ceb39d04c13feb48b` with a clean working tree. All 67 files
matched the accepted verification hashes before commit. No tests were repeated
for this unchanged source. The commit remains unpushed.
Vibe64, its seeds and Online were not changed; publication,
deployment and application migrations remain paused.

The master is **194/250 complete (77.6%); 56 open**. This closes M-07/M-08 and
R-B0-07/R-B1-05. The other 32 consumer residuals and 10 migration coordination
items still include application acceptance or combined evidence; all 14 final
cross-repository review/report items remain open. The new narrow jskit-ai goal
does not complete the original multi-repository master plan.

### Accepted implementation and artifact

- The archived 42-file patch was applied and reconciled with the merged
  integrations and assistant work. Its original checksum is unchanged.
- The host uses JsonRestApi directly. CRUD and user/workspace repositories use
  plain data, explicit output/returning choices and api.transaction ownership.
  Useful domain field/relationship mappings and Document/Documents methods stay.
  Obsolete input builders, response repair and duplicate completion owners are
  removed. No old/new runtime parser or compatibility framework was added.
- Both actual runtime importers, json-rest-api-core and crud-core, declare the
  exact v2 Git commit `f97dc859321aee41915f3b0e256a861c382bc1b3`; hooked-api is
  absent from the installed graph. The npm-generated lock and fresh-cache import
  proof identify that artifact. All 130 runtime/declaration/package files match.
- HTTP status mapping now handles documented library error codes/subtypes at
  the existing HTTP boundary. Plain and JSON:API errors preserve outcomes and
  redact internal failures. Default CSRF retry refuses pending, committed or
  unknown writes, including streaming requests. Application-defined retry hooks
  remain explicitly application-owned.
- Current source patterns delegate to the shared v2 implementation. Authored
  migration guidance and generated references/catalog are current and
  deterministic. The detailed JSKIT notes live in the existing application
  migration guide, keeping the core operational reference within its size limit.
  The library's GUIDE 33 also explains the JSKIT port and remaining app steps.

### Final verification

All execution used Node 24.6.0. The full `npm run verify` checkpoint exercised
2,793 tests: 2,783 passed, one documentation-size assertion failed, and nine
conditional checks were skipped. There were no runtime failures or cancellations.
Lint, release coordination tests, runtime dependency audit, CI contracts,
package/provider/migration imports and deterministic generation passed before
the workspace suites. Log: `/tmp/jskit-v2-verify-20260913.log`.

The failing prose was moved to the existing migration reference. A first short
link still exceeded the core reference budget by 189 bytes (the baseline had
only 21 bytes spare), so it was removed; the skill already links the dedicated
migration guide. No generator workaround or larger budget was retained.
The final agent-docs package check passes 19 tests with its one browser gate
skipped, deterministic generation passes, and the VitePress build passes.
Log: `/tmp/jskit-v2-docs-final-20260913.log`. The skipped browser gate passed
separately below. The broad command itself exited 1; this is staged acceptance
after the focused documentation correction, not a claim that it exited 0 or
that every runtime suite was repeated for prose. Executable consumer source is
unchanged after that broad checkpoint; the later test-only PostgreSQL fixture
extension passed its focused checks.

Additional real checks passed:

| Verification | Result | Evidence |
| --- | --- | --- |
| MySQL 8.0.46, rewarded and user/workspace shipped migrations/workflows | 5 + 7 passed, no skips | `/tmp/jskit-v2-native-oracle-20260913.log` |
| MySQL 8.0.46, connector persistence, concurrent pools, rollback and CLI restart | 7 passed, no skips | `/tmp/jskit-v2-native-connectors-20260913.log` |
| PostgreSQL 16.15, six shipped user/workspace migrations and repository workflows | 7 passed, no skips | `/tmp/jskit-v2-native-postgres-20260913.log` |
| Browser: linked package caching, responsive date filters, adaptive navigation and preserved forms | 1 + 1 + 2 passed, no skips | Tool execution records; commands below |
| Browser: assistant scrolling and billing/account states | 1 + 1 passed, no skips | `/tmp/jskit-v2-browser-assistant-20260913.log`, `/tmp/jskit-v2-browser-payments-20260913.log` |
| Final lock consistency | `npm ci --dry-run --ignore-scripts` passed | `/tmp/jskit-v2-lock-final-20260913.log` |
| Library migration guide site | `npm run docs` passed | `/tmp/jra-jskit-migration-docs-20260913.log` |

All nine conditional skips in the broad checkpoint were exercised separately:
six browser cases, the connector database suite, and two native duplicate
recovery cases. Native/browser suites add nested assertions, so these counts
must not be added to the broad run as a distinct-test total. Owned databases,
temporary install/cache directories and browser fixtures were cleaned up.

From jskit-ai with Node 24 selected, the three browser commands whose results
are retained in tool records are:

```sh
JSKIT_VITE_LINKED_PACKAGE_CACHE_INTEGRATION=1 node --test packages/agent-docs/test/viteLinkedPackageCache.browser.test.js
JSKIT_HTTP_WEB_DATE_FILTER_VISUAL_INTEGRATION=1 node --test packages/http-web/test/crudListDateFilterSurface.browser.test.js
JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1 node --test packages/shell-web/test/adaptiveShell.browser.test.js
```

JSKIT's actual consumers are JavaScript: provider imports, syntax checks and
runtime workflows provide their validation. There is no downstream TypeScript
compilation claim. Rewarded's shipped ON UPDATE defaults are MySQL-specific;
its SQLite tests exercise resource-generated tables, while native MySQL tests
exercise the actual migrations. PostgreSQL acceptance covers the supported
user/workspace path. The separate connectors configuration UI was unchanged
and is outside this JSON REST migration.

The [manifest](v2-source-preparation-manifest.json) retains the original parked
patch and adds the current consumer file hashes, package resolution and exact
verification accounting. Remaining broad-plan requirements stay unticked; their
jskit-ai portions have this evidence ready for the later application batch.

## Active jskit-ai migration, 2026-09-13

The user has authorized migration of the current jskit-ai main branch to v2,
including dependencies, templates, generated outputs and actual consumer
verification. This supersedes the historical consumer pause below for jskit-ai
only. Vibe64, its seeds and Vibe64 Online remain paused. Publication and
deployment are outside this goal; jskit-ai pushes to main trigger a docs
deployment, so this migration remains unpushed.

Starting source: clean jskit-ai main at
`dff33b4f7ceb2253baa96d84e602464dbd4f83a5`, including the completed integrations
and assistant contracts. `git apply --check` passed and the saved 42-file
`v2-source-preparation.patch` was applied. Its original checksum and manifest
remain historical evidence. The library is the pushed, already verified commit
`f97dc859321aee41915f3b0e256a861c382bc1b3`.

Decisions and required acceptance:

- Pin the unpublished library using its full HTTPS Git commit, remove
  hooked-api, and generate the lock with npm. Do not commit local dependency
  paths or publish a release to make the migration testable.
- Retain JSKIT's Document/Documents methods. Migrate their implementation to
  plain write data, explicit output selection and library-owned transactions.
- Preserve raw Knex transaction owners in integrations that do not invoke
  JSON REST operations.
- Reconcile the new assistant pagination integration test, which was absent
  from the patch, and verify rewarded grants with real database persistence
  and rollback rather than only mocked repositories.
- Use Node 24 for targeted checks, then one comprehensive final checkpoint.
  The existing library test results do not establish consumer acceptance.
- Rebuild catalog and agent documentation from their authored sources and
  verify generation is deterministic. Update the migration guide and master
  checklist from actual results; mixed application requirements remain open
  until their remaining consumers have been migrated.

Current master remains **190/250 complete; 60 open**. Source application is
complete; final acceptance is pending.

Verified intermediate evidence (not a completed final gate):

- Node 24.6.0 `npm install --package-lock-only --ignore-scripts` and `npm ci`
  passed in jskit-ai. Installed `json-rest-api` is 2.0.0 at the selected full
  commit; 130 runtime/declaration/package files match the source byte for byte.
  A fresh-cache temporary install passed with `GIT_SSH_COMMAND=false`, then
  public imports and the same file comparison passed. npm canonicalizes the
  GitHub lock entry to `git+ssh` but fetches this public pinned artifact without
  SSH. The temporary install/cache were removed. Logs:
  `/tmp/jskit-v2-install-20260913.log`, `/tmp/jskit-v2-artifact-20260913.log`.
- The first 106 targeted repository tests had 103 passes and three stale fixture
  assumptions: an obsolete private projection metadata path, the previous
  SQLite raw date representation, and missing create-operation metadata in an
  after-commit test resource. The projection now executes a real query; dates
  verify UTC storage and public leap-day output in four time zones. All four
  selected correction checks passed. Logs:
  `/tmp/jskit-v2-repositories-targeted-20260913.log`,
  `/tmp/jskit-v2-repositories-corrections-20260913.log`.
- New assistant SQLite integration passes 4 tests; rewarded SQLite resource
  workflows pass 5; users/workspaces run six shipped migrations with 5 passes
  and 2 native duplicate-recovery cases skipped. Those two cases require a
  supported application dialect (MySQL/PostgreSQL duplicate codes).
- The same native suites passed against Oracle MySQL 8.0.46: rewarded 5/5 and
  users/workspaces 7/7, no skips or failures. They execute four rewarded and six
  users/workspaces shipped migrations, actual repositories, mapped relationships,
  scope isolation, shared transactions, raw SQL participation and rollback.
  `/tmp/jskit-v2-native-oracle-20260913.log` records execution; the owned server
  and temporary data directory were removed. An earlier attempt using the
  system MariaDB alias failed before any tests; it is not MySQL evidence.
- Dependency review added the direct v2 import dependency to crud-core as well
  as the host. Root and CI no longer claim Node 22 support; existing Node 26
  support is retained, while this goal executes checks only on Node 24. Internal
  JSKIT package versions remain coordinated at their current values. No release
  preparation or version bump is needed to test current workspace source.
- The authored guide/search pattern and stale AGENTS generator reference were
  corrected; catalog and agent-docs generation ran. Final deterministic
  generation checking waits for the final source. Rewarded now has a package
  test script so its regressions participate in the normal workspace gate.
- Review found two additional HTTP/client gaps: typed library error status
  mapping and automatic CSRF retry of pending/committed/unknown writes. The retry
  fix has 44 focused passing client/retry tests, including actual request counts
  for ordinary and streaming requests. HTTP mapping and real Fastify execution
  are in progress; Fastify 5.12.3 is a root test dependency. Neither review result
  substitutes for the final comprehensive consumer gate.

## Historical preparation and library verification

Updated 2026-09-12. This records the user's newly authorized preparation batch;
it supersedes the archive's blanket consumer pause only for the work below.
The original parked patch and manifest remain historical evidence, not the
complete current migration.

**Current checklist, revision 3: 190/250 complete (76.0%); 60 open.** The
maintainer requested that completed mixed work close and only unfinished work
receive new entries. A5-02/A5-03/A5-12 close against existing evidence. The 34
old mixed IDs now describe completed library work; 34 linked consumer residuals
and two separate library residuals preserve the unfinished scope in Part R.
This is a checklist split, not 34 new implementations or completed consumer
migrations. R-L01 now closes with recorded three-database measurements. A7-05 also closes after reviewed SQLite/Redis failure regressions. A9-07/A9-08 now close after final diagnostic-owner acceptance. The three implementation typing items are accepted after focused checks and independent review. The final packed check exposed missing declaration owners under A9-05. Those declaration errors are corrected and the packed check passes. R-L02 now closes against the extracted final package. All eight library entries are accepted; 46 consumer/migration
entries and fourteen final review/report entries remain. Comprehensive verification passed; work is paused before consumers. The earlier counts and
unrun-check statements below are historical; see the completed verification
checkpoint and latest reconciliation at the end.

**Testing resumed:** the maintainer explicitly lifted the old test restriction:
run targeted tests whenever possible, and comprehensive tests when strictly
justified. Use Node 24 only. The former blocked checkpoint is historical;
active consumer/dependency work remains paused. The master starts this
verification batch at **144/214 complete, 70 open**.

## Deslop before comprehensive verification, 2026-09-12

The maintainer interrupted the combined test run and explicitly ordered another cleanup first, covering code written since the last recorded deslop checkpoint (`f242aa5`) through the current working tree. This includes later committed API/context/runtime work and current uncommitted changes. Review concrete complexity and simplify it; preserve behavior and required unknown/stage contracts. Consumers stay untouched. Run comprehensive verification only after the cleanup and its review are complete.

The owned verification shell/process group212314 was stopped with SIGTERM; command session83821 exited143. Both query budgets passed. The ordinary runtime suite was interrupted:5517 reported tests,5467passed,0failed,50cancelled,0skipped; it is NOT a completed full-suite result. Later canonical/Express4/lint/docs stages never ran. Output is retained in `/tmp/jra-eight-final-stages-20260912.log`. The separate packed declaration correction had already passed (173files, artifact126c68ba2ef972d12f188e8cb9b4c6eea3f23db1); that identifies its earlier snapshot, not future cleanup output.

Owners: lifecycle agent handles resource/context/input contracts; storage agent handles SQL/schema/query/write helpers; connector agent handles HTTP/Socket.IO/files; root handles lib/runtime/error/transaction/diagnostic helpers, development scripts, combined review and evidence. Do not start another comprehensive run while those edits are active. Meaningful focused checks remain authorized. The master remains189/250 complete,61open; R-L02 waits for the final post-cleanup artifact.

The maintainer then explicitly requested a **second cleanup after the first**. Both passes must finish before comprehensive verification. Second-pass reviewers rotate ownership: connector reviewer checks runtime/error/transaction helpers; storage reviewer checks connectors/files; lifecycle reviewer checks storage after finishing its first pass; root reviews lifecycle/contracts, scripts and evidence. Simplification must preserve ordering and failure behavior; do not force changes where the existing code is already direct. Focused checks are allowed during both passes.

Both implementation passes and the final read-only review are complete. Three test assertions were strengthened: check the ID seen by the post-write hook, reject any prematurely narrowed raw storage POST result, and test serializer return typing independently of optional presence. The corrected ID suite passes 24/24 in each storage mode; internal typecheck also passes.

Concrete cleanup: PUT walks existing relationship maps directly; foreign-key validation uses one pass; storage helpers return named functions without a temporary wrapper object; dead scope/ID branches are removed; canonical cursor rows are trimmed and ordered once before cursor extraction. HTTP connectors share their diagnostic policy, file upload cleanup records transaction ownership at the upload, and Socket.IO uses direct notification selection and contained logging. Runtime method-name validation has one owner. Error formatting uses one budget predicate and no redundant recursive stack flag; write-error metadata stops at proxy prototype boundaries instead of tracking cycles. Lifecycle declarations and development scripts now avoid dense multi-purpose expressions and positional argument lists.

Two corrections accompany cleanup: relationship failure diagnostics retain names such as `postRelationship`, and write-error wrapping cannot follow an invented infinite proxy prototype chain. Durable regressions cover both. The attempted logger-generic removal was reverted because the generic deliberately permits additional properties on real loggers; its unchanged type fixture caught that constraint. No replacement framework, context copying or transaction abstraction was introduced.

Focused Node 24 evidence: first-pass storage 122 ordinary + 122 canonical + 100 schema cases; lifecycle 125 + 121; HTTP 31 per mode, selected socket/file 26 per mode, Redis 18 per mode; root runtime/diagnostics 130. Second-pass storage 2 ordinary + 20 canonical; socket/file 16 per mode; diagnostics 109 followed by 40 error-context cases after the final proxy correction. Small stress workloads and literal PUT/PATCH/hooks guide examples passed in both SQLite modes. Typecheck and affected JavaScript lint passed; an explicitly listed declaration file was ignored by ESLint and is checked by TypeScript. These selections overlap and are not a distinct-test total. Logs are `/tmp/jra-deslop-*`; comprehensive results and the final packed guide artifact remain pending below.

The single post-cleanup `npm run verify` subsequently passed under Node 24.6.0, with output in `/tmp/jra-post-deslop-verify-20260912.log`. Source is frozen; 103 changed non-archive files were hashed before final execution. The packed declaration stage passes for artifact `7de97a9f055111af4c797dd3ca2c9becbcce2421` (173 files, 441672 bytes, 257 local links, 28 exports and 24 negative type checks). Affected native coverage is limited to `conformance-queries`, `conformance-storage-boundaries`, `conformance-storage-return-id` and `db-schema-conformance`, on PostgreSQL and MySQL in both modes. This is not another full native matrix. Consumers and the archived 42-file patch remain untouched; no commit or push is requested in this batch.

## Hard boundaries

- **Targeted tests are authorized.** Validate the prepared library changes and
  fix failures before expanding. Comprehensive tests are authorized when shared
  changes or other concrete evidence justify them; avoid repeated full runs.
  Earlier unrun/deferred statements below describe the preparation checkpoint.
- Do not edit either active jskit-ai checkout, Vibe64, its seeds or remote apps.
  The prepared consumer source is archived below; its temporary clone is removed.
- Leave the integrations agent's new packages, authentication changes, shared
  lockfile, package catalog and generated agent documentation untouched.
- Defer dependency/version changes, installation, shared generated output,
  consumer acceptance, publication and deployment until the integration
  checkpoint and the relevant authorization. Source preparation is not a
  functioning installed v2 consumer or a completed migration.
- Do not add a v1/v2 compatibility parser or a second transaction framework.
  Preserve JSKIT's existing integration-facing Document/Documents repository
  methods while migrating their implementation to the selected v2 contract.

## Locations and snapshot

- Library: `/home/merc/Development/current/json-rest-api`, pushed commit
  `35919bdb3f252b3fe82581219cccbc42406ccae8` before this batch.
- Current jskit-ai: `/home/merc/Development/current/jskit-ai`, main at
  `70163546304ee1fed80cbf1c6ec67517294db855`.
- Active integrations: `/home/merc/Development/current/jskit-ai-integrations`,
  branch `integrations`, same base commit at inspection. Its work is mostly
  uncommitted, so checking branch commits alone is insufficient.
- Temporary local clone for the prepared source migration:
  `/tmp/json-rest-api-jskit-v2-aQpHrK`. Created from the local jskit-ai repository;
  no remote fetch, dependencies or application execution. It is not a registered
  worktree. Preserve unrelated active-checkout changes; do not copy them here.
- The active main checkout's pre-existing modification to
  `packages/crud-core/test/assistantPagination.integration.test.js` is unrelated
  work and must remain untouched.
- The library's user-owned `old/.technical-adoption-assessment.md.swp` remains
  untouched and excluded from commits.

The new patch and base/file manifest are captured in this archive, and the
temporary clone is removed. The earlier `migration.patch` and `manifest.json`
remain intact. No patch was applied to an active checkout.

## Conflict assessment and ownership

At the read-only inspection, integrations had 62 changed tracked paths and 500
untracked files. None overlapped the original 13 migration files, and none were
under json-rest-api-core, crud-core, users-core, workspaces-core or database-runtime.
This is a snapshot, not a guarantee about future edits; refresh before landing.

The intended source footprint is the JSON REST host, shared CRUD repository,
user/workspace repositories and their affected contract fixtures. Expand only
for demonstrated callers of the changed contract and record why.

The shared behavioral boundary is transaction ownership:

- `rewarded-core/src/server/service.js` opens a repository transaction for the
  reward-session update and receipt creation. Keep those operations atomic.
- CRUD-backed `withTransaction` currently creates raw Knex transactions; v2
  resource writes need transactions owned by `api.transaction`.
- `connectors-core/src/server/knexConnectionStore.js` uses the generic database
  helper for raw SQL exclusively. Do not globally change that helper to require
  json-rest-api or disturb its lock/credential-storage transaction behavior.
- Keep `createDocument`, `patchDocumentById`, other Document/Documents methods,
  ordinary feature payloads and JSON:API response shapes stable. The existing
  shared adapter should select v2 input/output explicitly.
- Rewarded's current tests mock transaction handles and resource registration;
  they do not prove compatibility with the actual v2 transaction implementation.

After source reconciliation, resolve manifests and the lockfile once and rebuild
the package catalog and agent-docs from the combined source through their owning
generators. Do not hand-merge generated fragments. The old CRUD generator path
named by AGENTS.md is absent in this checkout; inventory current authored
patterns/templates instead of assuming the old generator still exists.

## Master checklist accounting

The master is `old/library-improvement-plan.md`, not the completed 29-item
`last_todo.md`. A7-04 was reconciled as complete before this batch: the master
recorded **139/214 complete, 75 open** at the start of preparation. The review
below reconciles five more older entries: **144/214 complete, 70 open**.

The first six entry points are below. The user then explicitly asked to target
more and go as far forward as possible: these are **not a limit**. Review all
75 open entries, reconcile completed work using actual evidence, and prepare
additional independent library and consumer-source work within the boundaries
above. Keep unexecuted acceptance open.

| Items | Work prepared now | Acceptance still needed |
| --- | --- | --- |
| A7-06 | Correct remaining setup/logging failure boundaries in the library. | Execute the new focused regressions after tests are authorized. |
| M-08, B0-09 | Prepare the current jskit-ai host/repository source migration. | Reconcile integrations, land dependencies and finish actual consumer acceptance. |
| B2-01, B2-07, B2-10 | Prepare managed transaction ownership through the existing repository contract. | Verify combined transaction participants, raw SQL and consumer workflows. |

**No new completion ticks are promised for preparation alone.** Do not close
mixed consumer items or the full goal based on a saved patch or static review.

## Verification deferred until authorized

No commands in this section have been run for this batch.

- Library: new regressions for null/undefined failures and throwing/rejecting
  warning loggers in positioning setup and any other corrected setup boundary.
  Existing core error-preservation and acknowledged-commit checks are relevant.
- Consumer host: setup/plugin registration, explicit v2 input/output selection,
  removed legacy options, scalar and relationship values, temporal handling,
  sparse fields, missing-resource and typed/write-outcome error behavior.
- CRUD/user/workspace repositories: their affected contract suites, preserving
  existing public repository methods and response shapes.
- Transactions: managed multi-operation success/rollback, nested participation,
  raw SQL in managed operations, after-commit timing and failed completion.
- Integrations: a real rewarded grant and forced rollback through the migrated
  shared repository, proving session/receipt atomicity; mocked service tests
  alone are insufficient. Retain raw connector-store transaction behavior.
- Later coordinated acceptance: intended packaged v2 library and consumer
  dependencies, generated callers/docs, relevant app and seed workflows.

Use Node 24 only when checks resume. Select focused checks for the actual changes;
the user has not authorized another comprehensive run. Record exact commands,
results, artifacts and limitations after execution, never in anticipation.

## Historical source-preparation progress, before authorized verification

- The 42-file source migration is captured in `v2-source-preparation.patch` with base/file hashes in `v2-source-preparation-manifest.json`; the temporary clone has been removed.
- A7-06 remains open pending execution. Positioning automatic-index warnings
  and Socket.IO restore failure diagnostics are corrected, with focused unrun
  regressions. Positioning now validates the compiled enriched field too.
- No tests, dependency installation, consumer generation or application commands
  have run. The library's static documentation build succeeded as recorded below.

Prepared source now covers the host, shared CRUD adapter, all six user/workspace
repositories, the duplicate-error classifier and the authored search example.
The host uses `JsonRestApi`; writes use `data`; repositories explicitly request
plain rows or JSON:API documents; repository transaction owners use
`api.transaction`. The old temporal finish hook and JSON:API input builders are
removed. JSKIT's field/relationship aliases, domain normalization and public
Document/Documents methods remain part of its adapter contract.

Duplicate recovery now distinguishes a confirmed standalone rollback from a
failed participant. Never query again inside a transaction marked rollback-only.
Domain conflict errors can retain their business code while propagating the
original cause and transaction outcome. The shared database classifier follows
error causes and returns the matched driver error for constraint inspection.
It does not retry operations or change generic raw SQL transaction ownership.

The authentication caller inspection found **no raw transaction forwarded to
profile projection** in either current checkout. Login can invoke projection
inside the local-auth backend callback, but the projection opens its own owner;
that pre-existing separation is not a new incompatible transaction handle.
No authentication source change is justified by this migration finding.

Further library review found a compiled-schema inconsistency in positioning:
registration validated the authored field while other phases used the enriched,
compiled field. The correction and enrichment regressions are prepared; A5
acceptance remains open until executed. The removed internal helper paths are
listed in the public migration guide, whose static build has succeeded.

Parallel ownership for this batch:

- `types_connectors`: library setup/error handling and the grounded unused-helper
  cleanup in `old/unused-surface-audit.md`, including authored regressions and
  preservation of useful public-query coverage. No tests run.
- `docs_examples`: temporary-copy json-rest-api-core and crud-core source and
  authored contract tests, excluding assistantPagination.integration.test.js.
- `context_remaining_assessment`: temporary-copy users-core/workspaces-core
  source and authored tests; coordinate shared managed-transaction needs with
  the host owner. Do not globally rewrite raw-SQL database helpers.
- Root: master reconciliation, cross-package caller inventory, durable evidence,
  remaining justified source/documentation work, final patch capture and cleanup.

The unused-helper cleanup includes dormant index creation, misleading index
advice, redundant field-selection/mapping wrappers and standalone canonical
counting. Preserve real pagination, permissions and transaction visibility;
new or moved behavior assertions remain unrun until the user authorizes tests.

## Disposition of all 75 entries open when preparation began

This is a scope and evidence review, not 75 completion claims. Five older entries
are reconciled complete; **144/214 are now complete and 70 remain open**.
Prepared code has not passed new acceptance. Active app/seed changes, dependency
installation, generation and tests remain outside this batch.

| Master entries | Current disposition |
| --- | --- |
| A9-02, A10-01, A10-02, A10-03, B0-08 | Reconciled complete from committed implementation and prior verification; see the master reconciliation. New batch checks remain deferred. |
| M-02, M-12 | Current maintained JSKIT and integration call sites inspected. Direct calls are covered by the prepared host/CRUD/six-repository port; app and generated-output refresh still required at landing. |
| M-03, M-13 | Workflow inventory includes CRUD, users/workspaces, profile lifecycle and rewarded transactions. Actual paired workflows, permissions, assistant pagination and app/seed execution are deferred. |
| M-05, M-14 | Public migration guide exists; this archive records selected host/input/output/error/owner changes. Compatible dependency, engine, revision and lockfile decisions require the integration checkpoint. |
| M-06 | Architectural review favors current runtime/compiler/storage helpers. No extra ORM, transaction framework or compatibility parser is justified. Remaining optimization/type/diagnostic proposals need their own evidence before full architectural acceptance. |
| M-07 | Current branches and uncommitted integration paths inspected before preparation; refresh again before landing because active work can still change. |
| M-08, B0-09 | Host, shared CRUD and six user/workspace repository source prepared in the local clone. Dependency/engine rollout, generated callers and installed consumer acceptance remain. |
| M-09 | Authored server-search example ported; feature examples inherit the shared CRUD adapter. Catalog and distributed/generated agent docs must be rebuilt once from combined source. |
| M-10 | Vibe64, public/accounts seeds and other applications remain untouched under the current boundary. |
| M-11, A4-16 | Obsolete host input/temporal helpers and redundant repository transaction dependencies removed in prepared source. Final apps/generated-output search and acceptance remain. |
| A4-01, A4-04 | Library hook/context contract and regressions exist. Current JSKIT context and hook consumers inspected; new prepared consumer contracts and app hook inheritance still require execution. |
| A4-08, A4-10, A4-12 | Library lifecycle/response implementation exists. Prepared consumer writes select data/format/returning; migrated caller behavior and full POST/PUT/response acceptance remain open. |
| A4-13, A5-06, B0-11 | Prepared host removes redundant temporal formatting and calendar-date serializer; native/scoped serializer, include, fieldset and missing-resource behavior must be verified against the real installed v2 artifact. |
| A4-18, A6-16 | Existing library traces/examples have evidence; paired custom-query/hook/app integration checks are not authorized now. |
| A5-02, A5-03 | Found and corrected positioning reading authored rather than compiled fields. Enrichment/type/setter/removal regressions are authored but unrun. |
| A5-10, A5-11 | Existing compiler and consumer schema/collection/projection translations inspected. Positioning correction advances early validation; consumer registration and any later app customization still need acceptance. |
| A5-12 | Dormant derivation/index/selection/count helpers removed and useful pagination assertions retained. Equivalent behavior, initialization costs and request measurements are unrun. |
| A6-09, A6-10 | Library canonical proxy already removed. Current JSKIT custom filters use native Knex and explicit physical columns; no second proxy adapter is needed. Remaining app/custom-hook inventory and execution stay open. |
| A7-01, A7-07, B2-01, B2-07, B2-10 | Prepared repository owners use api.transaction and preserve callable raw SQL participation. SQL-only generic owners remain unchanged. Multi-operation success/rollback tests authored; actual rewarded/app and nested-owner acceptance remains. |
| A7-05, A7-06 | Positioning and Socket.IO best-effort diagnostics now tolerate arbitrary failures and failing loggers. Focused regressions unrun; broad error-boundary acceptance cannot close from static review. |
| A8-04, A8-12 | Existing bounded relationship query optimizations have recorded library evidence. Further bulk/per-record work needs demonstrated benefit and preserved hook semantics; new measurements and consumer regressions are deferred. |
| A9-03, A9-04, A9-05 | Public hook types and selected internal boundaries are checked, with existing negative fixtures. Full changed implementation coverage is still partial; no blanket any/suppression or unverified mass annotation added. |
| A9-07, A9-08 | Existing bounded/field-aware diagnostics retained. Current setup sink fixes are authored; whole-owner phase/redaction acceptance, including early metadata and external error text, remains incomplete. |
| A9-09 | Current library declarations are published in source and have recorded packed checks; real migrated consumer/app type and artifact validation remains. |
| A10-08 | Current maintained JSKIT has no private library imports; removed internal helper paths documented. App/generated caller and optional-peer acceptance remains. |
| A10-09, A10-10 | Prior library clean-package checks exist. New paired tarball resolution, Node24 engine/dependency changes and clean consumer install remain deferred; no installation was attempted. |
| B0-07 | Library connectors already select JSON:API explicitly. JSKIT repository/client/error boundary preparation advances consumer coverage; actual HTTP and assistant pagination remain unrun. |
| B0-12 | Prior library migration-guide execution exists. New prepared consumer source, generation and packaged guide/workflow checks have not run. |
| B1-02, B1-04, B1-05 | Prepared duplicate/error handling preserves cause and transactionOutcome, refuses recovery inside failed owners, and does not treat a committed write as a safe retry. HTTP/schema/client outcome propagation is included in preparation; runtime acceptance remains. |
| B4-02, B4-07 | Library failure-propagation default remains. Prepared host no longer relies on temporal finish repair or swallows pending/committed/unknown missing-write failures. Real HTTP/programmatic/policy/outcome parity with migrated consumers remains. |
| C1-01, C1-02, C1-03, C1-04, C1-05, C1-06, C1-07 | Independent source reviews, removed-call searches and regression authoring advance the final review. These global conditions cover all changed repositories and required execution; neither a static review nor this saved patch completes them. |
| C2-01, C2-02, C2-03 | Final combined tests, artifact/runtime/count records and before/after measurements remain deferred. Prior results cannot be relabelled as acceptance of this batch. |
| C2-04 | Static diff and source/path ownership inspection can be completed for preparation. Recheck final combined repositories, generated output and dependencies at landing. |
| C2-05, C2-06, C2-07 | This disposition and preparation report preserve current progress. Full checklist reconciliation, final report and goal completion still require the coordinated migrations and required acceptance. |

## Completed preparation and handoff

The [42-file source patch](v2-source-preparation.patch) and
[manifest](v2-source-preparation-manifest.json) are the durable consumer artifacts.
The old 13-file patch is preserved as historical evidence; do not stack the two.
Patch SHA-256: `4a873765c707bad4ace4d9831a12582e170a620bad187fb35ecb71086f18cbb2`.
The owned temporary clone was removed after checking the archived checksum and
every prepared file hash. No registered worktree or stash was created.

The final source footprint additionally includes HTTP error schemas, standard
and JSON:API serialization, client error decoding and the shared outcome
allowlist. Unexpected JSON:API 500 responses now use the existing sanitized
message/detail policy. Causes stay private. CRUD application `afterCommit`
failures now report the acknowledged commit through the existing library error
class, including when the callback throws a frozen Error, null or undefined.
Before/after/owner failures are not relabelled as committed.

Repository constructors and providers no longer require a separate unused Knex
argument; the JSON REST host owns the database connection. Native SQL-only
repositories and integration connector storage retain their generic owners.
The host's collection helper now requires the selected `{ data: [] }` envelope;
it no longer accepts obsolete bare-array/null responses. Default error logging
is preserved, and an injected logger remains supported.

Three independent source reviews covered compiled positioning, host/relationship
shapes, transaction and duplicate recovery, and server/client error exposure.
They found the compiled-field, default logger, duplicated-code cause and CRUD
afterCommit gaps described above; those have source corrections and authored
regressions. Review is not execution evidence.

Final read-only ownership snapshot: both consumer checkouts remain at
`70163546304ee1fed80cbf1c6ec67517294db855`. Main has its one unrelated modified
assistant-pagination test. Integrations has 62 changed tracked paths and 501
untracked paths. **None overlap the 42 prepared paths.** Recheck this at landing.
No manifests, lockfiles, generated files, active apps, seeds or remote apps were
changed. No commit or push was made for this preparation batch.

### Dependency and generation decisions deferred

- Select the intended v2 library artifact, including this library worktree's
  changes, for json-rest-api-core; remove its direct hooked-api dependency.
- Add a direct json-rest-api v2 dependency to crud-core, which now imports
  `RestApiWriteError` for its acknowledged post-commit callback boundary.
  This deliberately reuses the library error class instead of creating another
  wrapper framework or forwarding it through an unrelated host export.
- Coordinate versions of changed internal packages and their consumers, update
  root/package engines to exclude Node 22 for this v2 stack, and test on Node 24.
- Reconcile provider capability metadata: UsersIdentityProvider and
  WorkspacesFeature now use the JSON REST capability for persistence; their
  old independent database requirement is no longer used in source. Retain
  database-runtime package imports that still supply normalization utilities.
- Resolve the shared lockfile/catalog once against combined integration source.
  Regenerate distributed agent docs from authored source; the old generator
  path in AGENTS.md is not present in this checkout.
- Keep Vibe64 and seeds paused. This source patch is not an installed migration.

### Exact checks to run later, only when authorized

**None of the commands below ran.** First restore/reconcile the prepared source
and install its intended dependencies in an authorized checkout. Use Node 24.
The library static docs build already succeeded; these are the deferred checks.

Library focused checks:

```sh
npm run typecheck
JSON_REST_API_STORAGE=knex node --test tests/computed-field-selection.test.js tests/conformance-field-names.test.js tests/row-policy.test.js tests/positioning-contracts.test.js tests/socketio-contract.test.js tests/conformance-queries.test.js
JSON_REST_API_STORAGE=anyapi node --test tests/computed-field-selection.test.js tests/conformance-field-names.test.js tests/row-policy.test.js tests/positioning-contracts.test.js tests/socketio-contract.test.js tests/conformance-queries.test.js tests/anyapi-descriptor-transactions.test.js
node scripts/test-databases.js pg tests/positioning-contracts.test.js tests/anyapi-descriptor-transactions.test.js tests/conformance-field-names.test.js tests/conformance-queries.test.js
node scripts/test-databases.js mysql2 tests/positioning-contracts.test.js tests/anyapi-descriptor-transactions.test.js tests/conformance-field-names.test.js tests/conformance-queries.test.js
```

Consumer focused checks, after dependency reconciliation:

```sh
node --test packages/database-runtime/test/duplicateEntry.test.js packages/json-rest-api-core/test/entrypoints.boundary.test.js packages/crud-core/test/jsonApiRepository.test.js packages/crud-core/test/defineCrudJsonApiFeature.test.js
node --test packages/users-core/test/repositoryContracts.test.js packages/users-core/test/authProfileSyncService.test.js packages/users-core/test/featureRuntime.test.js packages/workspaces-core/test/repositoryContracts.test.js packages/workspaces-core/test/featureRuntime.test.js packages/workspaces-core/test/workspaceInvitesRepository.test.js packages/workspaces-core/test/workspaceMembershipsRepository.test.js packages/workspaces-core/test/workspaceSettingsRepository.test.js packages/workspaces-core/test/workspacesRepository.test.js
node --test packages/kernel/shared/support/normalize.test.js packages/kernel/server/runtime/fastifyBootstrap.test.js packages/http-runtime/test/errorResponses.test.js packages/http-runtime/test/jsonApiRouteTransport.test.js packages/http-runtime/test/client.test.js
```

The error transport tests currently inspect schemas and invoke real handlers,
serializers and client helpers with stubs. Add/exercise actual Fastify response
serialization against the installed artifacts before accepting wire behavior.
Also execute real rewarded session/receipt commit and forced rollback, native
temporal/permission/include workflows, and assistant pagination while preserving
the active checkout's unrelated test changes. Broaden only for actual changed
boundaries or failures; another comprehensive suite is not authorized.

Existing JSKIT limitations observed, outside this v2 source port: trusted
AppError/ActionRuntimeError status handling bypasses the generic HTTP status
clamp; their messages/details follow the existing public application-error
policy. Later generic action/audit/idempotency failures are not automatically
attributed to the earlier resource commit. These are not claims that every
application-level side effect is now transaction-aware.


## 2026-09-12: Additional library diagnostics and hook typing

This continues the goal after the 42-file consumer source capture. Consumers and
the archived consumer patch remain untouched. **No tests, type
checks, lint, executable examples or application workflows ran.**

### Source corrections prepared

- `RestApiWriteError` now contains failures while inspecting copied error fields
  and terminates cyclic prototype metadata scans. Original cause and outcome
  survive. The existing error classifier contains throwing prototype checks,
  explicitly retains its type predicate. Error and Buffer identity use one
  small private prototype walk that stops before inspecting either a direct
  proxy or an inherited proxy; ordinary chains cannot cycle. Unit and real-write
  regressions cover failing inspection before processing, at finish and after
  commit, including failing diagnostic writers. These regressions are unrun.
- Existing enhanced formatting now bounds storage-, positioning- and file-owned
  logger calls. Include diagnostics retain counts instead of entire include
  path collections. Public query, file detector and positioning warning
  regressions exercise long names/messages without changing source values.
- Structured redaction skips inherited protected-property getters and recognizes
  hidden violations whose field identifier is inherited or accessor-backed.
  Restricted diagnostics skip custom `toJSON` conversion so it cannot read or
  relabel protected attributes or excluded stacks. Envelope getters are not
  pre-read, omitted hidden errors are not formatted again, and nested stack
  omission follows the selected policy. Key/property inspection failures stay
  inside formatting. Native brand checks avoid traversing proxy prototypes.
- `HookContext.knexQuery` now uses the existing `QueryFilteringState` envelope,
  matching its actual producer; the native builder is `.query`. The small
  permission wrapper is annotated and included in the existing typecheck scope.
  Four negative type cases and positive wrapper/envelope examples are authored,
  not executed. No runtime context hierarchy or compatibility adapter was added.

### Documentation build

Repository instructions require rebuilding reference prose. `npm run docs`
completed successfully after the final prose edits: the Gemfile dependencies
were already satisfied and Jekyll generated `docs/_site` in 7.86 seconds, exit 0.
No dependency installation,
server, browser, test or consumer generator was launched. Read-only inspection
confirmed the updated hook, positioning and restricted-diagnostics prose in the
generated HTML, including the new hook-table link's target anchor. This build
does not establish runtime correctness or repeat the previous full site audit.
All executable acceptance and shared consumer generation remain deferred.

### Remaining acceptance and known limits

A7-06 and A9-03/04/05/07/08 remain open. The master count is still **144/214
complete, 70 open**. Source preparation is not a passing test result.

- Static tracing cleared the suspected built-in write-message exposure:
  `jsonApiAttributes` checks object structure, while actual attribute validators
  run in `common.js` with a fixed top-level message. Custom **search** validators
  can return application-authored text containing filter values, and that text
  can become the top-level query message. Field-key redaction does not inspect
  arbitrary sentences. No public validation-message change was justified.
- Socket.IO authentication errors have no trusted resource schema to supply a
  resource-field policy. Arbitrary secrets embedded in external strings, and
  arbitrary work performed by allowed getters, are not handled by field-key
  redaction. No generic secret scanner was introduced.
- The formatter adds work to direct debug/trace paths, including no-op runtime
  sinks. Performance impact must be measured when execution is authorized;
  this change makes no latency or memory improvement claim.
- Broader lifecycle implementation typing and actual paired consumer validation
  remain incomplete.

### Final static review of this preparation

Independent review found a logger-capture regression introduced by the new file
plugin wrapper: cleanup warnings no longer observed later changes to
`api.log.warn`, bypassing existing failure-injection tests. The file plugin now
retains its original logger for resource-aware cleanup warnings and uses a
separate bounded logger for its direct debug/info calls. This also avoids
formatting cleanup errors twice. Existing file-failure assertions must run later.

The review also extended error/Buffer classification to stop at inherited proxy
prototypes. Identity checks treat proxies as opaque; a proxy around a typed API
error therefore receives unexpected-error classification, with the original
cause preserved. No proxy compatibility mechanism was added. The authored
regressions cover that traversal boundary and ordinary binary classifications.

The consumer conflict snapshot was refreshed after this review: still no path
overlap with the 42-file patch, and the temporary clone is absent. This completes
the bounded source-preparation review. The next acceptance step requires the
deferred tests and consumer coordination; all new acceptance remains open.

Additional focused commands to run **only after authorization**, on Node 24:

```sh
node --test tests/error-context.test.js tests/error-formatter.test.js tests/enhanced-logger.test.js
JSON_REST_API_STORAGE=knex node --test tests/conformance-runtime-failures.test.js tests/conformance-filter-diagnostics.test.js tests/file-handling.test.js tests/conformance-file-failures.test.js tests/positioning-contracts.test.js tests/conformance-include-limits.test.js tests/conformance-write-diagnostics.test.js
JSON_REST_API_STORAGE=anyapi node --test tests/conformance-runtime-failures.test.js tests/conformance-filter-diagnostics.test.js tests/file-handling.test.js tests/conformance-file-failures.test.js tests/positioning-contracts.test.js tests/conformance-include-limits.test.js tests/conformance-write-diagnostics.test.js
node scripts/test-databases.js pg tests/conformance-runtime-failures.test.js tests/conformance-filter-diagnostics.test.js tests/positioning-contracts.test.js
node scripts/test-databases.js mysql2 tests/conformance-runtime-failures.test.js tests/conformance-filter-diagnostics.test.js tests/positioning-contracts.test.js
npm run typecheck
npm run test:public-types
```

The previously recorded consumer and library checks still apply. Reserve broad
verification for an authorized checkpoint. No commit or push occurred.

## 2026-09-12: Authorized verification and connector corrections

The maintainer explicitly superseded the old testing ban. Targeted checks run
on Node **24.6.0**; comprehensive verification runs when the changed shared
boundaries justify it. Active consumer repositories, dependencies, generated
consumer output and the archived consumer patch remain untouched.

Initial verification found five internal typing errors and one unused test
import. The private prototype helper now returns a Boolean; native array-view
classification supplies the binary type narrowing. The formatter's key list
has an explicit string-array annotation. The unused row-policy test import is
removed. Internal typing then passed; packed public types had already passed.

Further source review found actual extension-boundary failures, reproduced
before correction:

- Conditional PUT replaced null/undefined precondition-read failures with a
  TypeError: all 16 new cases failed before the typed-error guard.
- Positioning replaced null/undefined target-read failures and swallowed a
  plain object carrying `subtype: 'not_found'`: six of eight cases failed before
  the guard; typed errors already propagated.
- HTTP mapping crashed on null/undefined read failures: two focused cases
  failed before the local nullish fallback.
- Express registration replaced a null rejection while reading its message.
  Registration diagnostics now use the bounded formatter, await the sink and
  preserve the original rejection. Express/Fastify HTTP error diagnostics also
  await/contain writer failures and retain them in existing cleanup diagnostics.
- Shared HTTP write-error classification uses the same guarded library-error
  identity as other wrappers, including inherited proxy prototypes.

### Completed focused checks

Counts are test invocations, not unique tests across overlapping selections.
Every successful selection below has zero failures, cancellations or skips.

| Checks | Results |
| --- | --- |
| Error-context/formatter/enhanced-logger unit files | 103 passed before and after the binary typing correction. Later mapper/context file alone: 39 passed, including both nullish cases and inherited proxy HTTP handling. |
| Runtime/filter/write diagnostics and include limits | 103 passed per SQLite storage mode. |
| Field selection/names, policy, file lifecycle, Socket.IO and queries | 462 ordinary + 507 canonical SQLite passes. |
| Positioning setup contracts, initial selection | 22 ordinary + 10 canonical on SQLite, PostgreSQL and MySQL. |
| Positioning after target-read correction | 41 ordinary + 29 canonical on SQLite and PostgreSQL. |
| Native runtime/filter/write diagnostics, field names, queries, descriptor transactions | PostgreSQL: 264 ordinary-selection + 262 canonical-selection passes. The 47 fixed-canonical descriptor cases repeat under both runner modes. |
| Same native boundaries plus both positioning files | MySQL: 305 ordinary-selection + 291 canonical-selection passes; same fixed-canonical caveat. |
| Conditional HTTP validator file | 110 per SQLite mode across Express 5/Fastify; Express 4 selection 55 per mode. |
| HTTP diagnostics and Fastify plugin files | 28 per SQLite mode; Express 4 diagnostic selection 17 per mode. |
| Internal types | First invocation reported five errors; corrected rerun exited 0. |
| Packed public types | Passed 28 runtime exports, 24 negative checks and 257 documentation links before later connector edits; final artifact check belongs to the comprehensive gate. |

Native versions were **PostgreSQL 16.15** and **MySQL 8.0.46**. Default binary
discovery initially failed before tests; the existing extracted binaries under
`/tmp/jra-database-binaries-dHBjur` supplied the actual servers. No installation
was needed. All owned native servers stopped and disposable database directories
were removed after the selections.

## Completed verification checkpoint

The changes affect shared error handling, storage diagnostics and HTTP
connectors, so one comprehensive `npm run verify` checkpoint is justified.
An initial invocation was stopped during packed-type preflight, before its
runtime suites, when the additional catch defects above were found. Its owned
temporary package directory was removed. The corrected invocation is logging
to `/tmp/jra-full-verify-final-20260912.log`.

The default suite completed with **6,200 tests: 6,196 passed, three failed, one
storage-specific test skipped** (294.46 seconds). The skipped canonical cursor
fixture cleanup is enabled in the AnyAPI invocation; canonical-only suite
selection is also intentional. The three failures all involved SQLite registry
rollback diagnostics: `SqliteError` inherits from `Error.prototype` but is not
a native V8 Error, so native-only classification lost its non-enumerable message.

The classifier now recognizes native errors and ordinary Error ancestry using
the existing proxy-safe walk. Four regressions exercise actual driver errors
in direct, nested and cleanup diagnostics. **176 focused checks passed**,
including all three original failures, protected getters and cyclic/inherited
proxy cases; internal typechecking also passed. The complete default invocation
was not repeated for this isolated diagnostic correction.

All remaining stages completed against the corrected source on Node 24.6.0.
No test jobs remain running. This is a checkpoint completed in stages, not a
claim that a single `npm run verify` invocation exited successfully.

| Stage | Final result | Log |
| --- | --- | --- |
| `npm run verify`, through the default suite | Internal types, packed public types and both query budgets passed; default suite 6,196 passed, three failed, one skipped out of 6,200. The three diagnostic failures were corrected and rechecked below. | `/tmp/jra-full-verify-final-20260912.log` |
| Error-context, formatter, enhanced-logger and registry-failure files | 176 passed, including all three failures from the default suite and four new driver-error cases; no failures or skips. | `/tmp/jra-error-classifier-focused.log` |
| `npm run typecheck` after the classifier correction | Passed. | `/tmp/jra-error-classifier-types.log` |
| `npm run test:anyapi` | 6,257 passed in 646 suites, zero failures, cancellations or skips. The canonical cursor fixture cleanup passed here. | `/tmp/jra-full-anyapi-final-20260912.log` |
| `npm run test:public-types` | Passed: 168 files, 439,790 packed bytes, 257 local documentation links, 28 runtime exports and 24 negative checks. | `/tmp/jra-public-types-final-20260912.log` |
| `npm run test:connectors:express4` | 530 ordinary + 532 canonical passes, zero failures, cancellations or skips. | `/tmp/jra-express4-final-20260912.log` |
| `npm run lint` | Passed after removing the unused import and formatting the new HTTP diagnostic tests. | `/tmp/jra-lint-clean-20260912.log` |
| `npm run docs` | Passed; Jekyll 15.728 seconds, no installation, server or browser. | `/tmp/jra-docs-final-20260912.log` |

The final packed artifact SHA-1 is
`abd6eee251ce6dd12ab009403e664a7b9807b397`. Only test formatting and archived
work records changed after that artifact check. The complete default suite was
not rerun after the isolated formatter correction; the targeted rerun and final
full AnyAPI invocation cover that correction. No observed failure remains
unresolved, and no new full run is needed solely for these ledger updates.

The native checks above are focused PostgreSQL/MySQL coverage, not full native
suite claims. Existing Redis evidence was not rerun. Consumer tests, dependency
installation, generated outputs and application workflows remain deferred to
the coordinated migration checkpoint; library verification does not validate
the archived 42-file consumer patch.

**A7-06 closes. The master is now 145/214 complete (67.8%), with 69 open.**
That is the count at this verification checkpoint; revision 3 above records
the subsequent evidence reconciliation and requested split.
The final owner review found no remaining concrete catch-classification gap in
the reviewed library boundaries. A7-05 remains open for broader secondary-error
preservation; metadata, internal typing, diagnostic policy and cost acceptance
also retain their separate open items. There are nine library-only boxes,
34 mixed library/consumer boxes, twelve migration boxes and fourteen final
review/report boxes. These are acceptance categories, not equal-sized tasks or
a claim that only nine implementation changes precede migration.

The consumer patch remains 42 files / 180,161 bytes, SHA-256
`4a873765c707bad4ace4d9831a12582e170a620bad187fb35ecb71086f18cbb2`.
Its manifest records the refreshed library file hashes and verification
separately from unexecuted consumer checks. Active consumer repositories were
only inspected for ownership overlap; no consumer files, dependencies or
generated outputs were changed. No commit or push occurred in this batch.


## Completed-work reconciliation and residual checklist

The user requested closing completed work and creating separate items containing
only unfinished requirements. The master now has **182/250 complete; 68 open**.
A5-02/A5-03/A5-12 close on current implementation and existing measurements/tests.
The 34 mixed entries now own completed library acceptance; their remaining
consumer requirements are preserved as R-<original ID>, with R-L01/R-L02 for
remaining bulk/reverse cost work and final packaged guide execution. These 36
new entries reorganize existing scope. They do not represent new feature requests
or verified consumer migrations. See the master
[reconciliation](../../../library-improvement-plan.md#2026-09-12-completed-library-work-and-residual-split)
and [current remaining-work split](../library-first-remaining-work.md).

A7-05 has two specific remaining owners, rather than an undefined further audit:
SQLite schema alteration plus failed connection release, and Redis startup or
shutdown plus failed cleanup/diagnostics. Source review identified these paths;
no new failure reproduction ran. Their concrete follow-ups and already accepted
owners are in [the diagnostic map](../diagnostic-boundaries.md#a7-05-secondary-failure-reconciliation-2026-09-12).

No tests or runtime code changed. The stale transaction-guide claim about the
removed hook dispatcher was corrected; `npm run docs` passed (Node 24.6.0,
3.159 seconds, `/tmp/jra-ledger-docs-20260912.log`). Only archived records and
that guide sentence changed after the tested package artifact. The manifest's
library hashes reflect the current files, and its previous artifact hash remains
explicitly the tested artifact, not a newly packed claim. The consumer patch and
its checksum are unchanged; consumer tests, installation and generation remain
pending. No commit or push occurred.

## Eight-item library batch in progress, 2026-09-12

R-L01 is complete: 108 measured scenarios and six dependent-hook checks pass on Node 24.6.0, SQLite/PostgreSQL16/MySQL8, both storage modes. See query-measurements.md. The other seven entries remain open while actual lifecycle/storage body checking and diagnostic fixes are reviewed. Focused regressions have exposed malformed POST helper IDs, stale relationship scopeName, lost minimal-read projections, early HTTP raw parser excerpts, and Redis setup cleanup failures; fixes and affected checks are in progress.

A final comprehensive checkpoint is justified by the changed shared storage/lifecycle bodies, but has not started. Run it only after those source changes stabilize. Then execute the literal migration examples against the final tarball, rebuild docs, refresh source/artifact hashes, and reconcile all eight items. Earlier artifact hashes and full-suite results describe the preceding source and must not be presented as final verification of this batch. Consumers and the archived 42-file patch remain untouched.

A7-05 is now complete after root review and 23 SQLite + 36 Redis lifecycle passes; the other six library entries remain open. Current count: 184/250, 66 open. The earlier seven-entry count in the batch-start paragraph is historical.

## Eight-item combined verification started

All three agents report runtime source stable. On Node 24.6.0, `npm run verify` is now running once against the combined source; log `/tmp/jra-eight-final-verify-20260912.log`. This checkpoint is justified by actual lifecycle/storage body changes and the boundary fixes; it is not another run for ledger or prose edits. Still pending: inspect every stage/count, fix any confirmed failure with affected checks, execute `npm run test:migration-guide:package` against final unchanged runtime, and refresh manifest hashes and checklist. No consumer checks or commit/push are authorized in this batch.

The initial combined command exited1 after internal types passed and packed public types found4 TS7016 errors in new storage declaration imports (JS-only module dependencies). No full runtime suite ran. A9-05 remains open until corrected; then resume remaining gate stages. Current188/250,62open. Log `/tmp/jra-eight-final-verify-20260912.log`.


## Final post-deslop verification and library pause, 2026-09-12

Both requested cleanup passes and their independent reviews are complete.
**All eight library items are accepted; the master is 190/250 complete (76.0%),
with 60 open. Work pauses here before consumer migration.** The 46 overlapping
consumer/migration entries and 14 final combined review/report entries remain
open; the full goal is not complete. No active jskit-ai, integrations, Vibe64,
seed or remote-app files were changed. No commit or push was requested.

One post-cleanup `npm run verify` completed successfully under Node 24.6.0
(exit 0; `/tmp/jra-post-deslop-verify-20260912.log`).

| Check | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Full ordinary SQLite invocation | 6272 | 0 | 1 |
| Full canonical SQLite invocation | 6322 | 0 | 0 |
| Express 4 ordinary selection | 542 | 0 | 0 |
| Express 4 canonical selection | 544 | 0 | 0 |
| PostgreSQL 16.15 ordinary selection | 199 | 0 | 0 |
| PostgreSQL 16.15 canonical selection | 199 | 0 | 0 |
| MySQL 8.0.46 ordinary selection | 203 | 0 | 0 |
| MySQL 8.0.46 canonical selection | 203 | 0 | 0 |

The main gate has **13680 passing test executions**. Its one skipped test checks
canonical cursor-fixture cleanup and passes in the canonical invocation; the
canonical-only suites also run in that mode. The separate affected native
selection adds **804 passing executions**. These are repeated coverage across
modes/drivers, not 14484 unique tests. The native selection is exactly the four
files recorded above, not the entire native matrix. No Redis run was repeated
after its passing first-pass checks because the second pass left that executable
setup/cleanup logic unchanged. Native logs are
`/tmp/jra-post-deslop-native-{pg,mysql}-20260912.log`. Owned database servers and
temporary directories were removed; the extracted guide package was removed too.

Internal types, packed public declarations/exports/local documentation links,
both query budgets, lint and the Jekyll documentation build all passed. The docs
build reused installed dependencies and completed in 2.139 seconds. Its optional
Faraday retry-middleware notice did not prevent the build; no dependency was added.

The selected literal migration-guide examples pass against the extracted package
in both SQLite modes, plus the schema guide's mapped-ID/generated-migration
example. Command: `npm run test:migration-guide:package`; exit 0;
`/tmp/jra-post-deslop-packaged-guide-20260912.log`. It reuses checkout test
dependencies while resolving runtime source and documentation inside the tarball.
**Artifact SHA-1: `7de97a9f055111af4c797dd3ca2c9becbcce2421`**, 173 files, 441672 packed
bytes. This is exactly the artifact accepted by the public declaration check
(28 runtime exports, 24 negative type checks and 257 local documentation links).
This closes R-L02. No fresh consumer installation or migration is claimed.

All 103 changed non-archive source/test/doc paths match their pre-verification
SHA-256 snapshot; current hashes are refreshed in the preparation manifest. The
archived 42-file consumer patch remains 180161 bytes with SHA-256
`4a873765c707bad4ace4d9831a12582e170a620bad187fb35ecb71086f18cbb2`. Only archived
status records changed after verification; no runtime or test edits followed it.

### Commit preparation, 2026-09-12

The maintainer subsequently requested committing all repository changes. The
103 source/test/doc hashes still match the tested snapshot, so tests were not
repeated. The existing user-owned editor swap file remains untracked.

The staged whitespace check passes with the archived
`v2-source-preparation.patch` excluded: its 177 single-space blank context lines
are unified-diff syntax, and there are no other trailing-whitespace lines in
that artifact. Its checksum remains unchanged; trimming those markers would
alter the saved migration patch. No source whitespace exception is needed.

The remaining 60 IDs were independently recounted and compared with the summary:
12 migration coordination, 34 consumer acceptance, and 14 combined final review,
verification and reporting items. None is an unfinished standalone library
implementation item. The final cross-repository review still includes checking
this library and correcting confirmed findings here if necessary.
