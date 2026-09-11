# Consumer migration evidence

Use the [coordinated release procedure](releasing.md) when consumer work resumes.
It separates source migration, exact-artifact checks, dependency updates and
publication; the historical results below do not replace that acceptance.

**Current status: consumer work remains on hold; library work has resumed.**
Do not change jskit-ai, vibe64, or their seeds for now. At the maintainer's request, the
unfinished 13-file source migration is preserved in
[pending-jskit-ai](pending-jskit-ai/README.md) for later reconciliation and
reapplication with the complete migration. The manifest records removal from
the active jskit-ai checkout and preservation of its other work. Historical
paired checks below describe the captured migrated source; they do not prove
that a checkout with the migration removed supports the new library contract.

This is the initial inspection for revision 2 of `library-improvement-plan.md`,
recorded on 2026-09-09. It is a snapshot, not a frozen consumer contract. The
maintainer has authorized breaking changes coordinated with jskit-ai and its
downstream apps, and reports a large expansion currently in progress.

## Located checkout and work in progress

The main checkout is `/home/merc/Development/current/jskit-ai`, on `main` at
`70163546304ee1fed80cbf1c6ec67517294db855` when inspected. Its working tree includes
unrelated connector packages, generated documentation, catalog changes, and a
package-lock change. None was modified by this inspection. Other jskit-ai
worktrees exist nearby; their existence does not identify the correct integration
target for a future batch. Recheck branches, commits, and diffs before editing.

The maintainer selected **vibe64 and the seeds its code references**. Other apps
will be ported later by the maintainer using the API migration guide. Unrelated
seeds and other worktrees are not migration targets.

Read the consumer's root `AGENTS.md` and applicable nested instructions before
edits. It requires generated docs to be produced by their generators and a short
visible checkpoint before nontrivial edits. Its reference to an older
`crud-server-generator` path did not exist in this checkout; current source lives
under `crud-core`. Reconcile current generators and tests instead of inventing
the missing path or copying stale templates.

## Integration found in the initial baseline

| Area | Located source | Contract or migration implication |
| --- | --- | --- |
| Direct dependency | `packages/json-rest-api-core/package.json` | Depends on `json-rest-api: ^1.0.29`; selected exports are tested explicitly |
| Library host | `packages/json-rest-api-core/src/server/jsonRestApiHost.js` | Installs RestApiPlugin, regular Knex, QueryProjections, RowPolicy, AutoFilter, and a local temporal plugin |
| Programmatic defaults | Same host | Plain/simplified API output, JSON:API transport output, full resource write returns, and jskit-ai ID normalization |
| JSON:API CRUD | `packages/crud-core/src/server/jsonApiModule/repository.js` | Uses query/get/post/patch/delete with explicit JSON:API format, inputRecord, transaction from options.trx, and context as the second argument |
| Plain-record consumers | User-profile/settings and workspace/membership/invite/settings repositories | Query with simplified=true; writes often rely on host defaults; transactions and context are forwarded |
| Resource declarations | Host resource-scope helpers | Translate columns, projections, relationships, response exclusions, serializers, and scope/policy configuration |
| Temporal workaround | Host JsonRestTemporalPlugin and date serializers | A finish hook traverses records/included values using schemaInfo; candidate for removal after direct library behavior is verified |
| Error translation | Host missing/fieldset helpers | Missing resources become null; typed fieldset errors become a jskit-ai 400. Some translation may remain legitimate domain integration |
| Transaction wrapper | `packages/database-runtime/src/shared/repositoryOptions.js` | createWithTransaction delegates to runInTransaction/Knex; integrate with or replace it rather than adding an overlapping helper |
| HTTP and assistant consumers | http-runtime and crud-core integration tests | Depend on JSON:API documents, sparse fields, metadata/links, and conversion of complete pagination into nextCursor |

The initial maintained-source search found the direct library imports in the
host and its boundary test. It did not find imports of the library's AnyAPI,
HTTP-connector, Socket.IO, or file-handling plugins in the searched packages.
That is preliminary usage evidence, not authorization to drop those library
capabilities or proof that future expansion cannot use them. The library's own
backend/connector verification requirements remain in the master plan.

## Executed consumer baseline

On Node 26.5.0, these selected current-consumer checks passed **65 tests, zero
failures, zero skips**, in 2.839 seconds:

```sh
node --test \
  packages/json-rest-api-core/test/entrypoints.boundary.test.js \
  packages/crud-core/test/assistantPagination.integration.test.js \
  packages/http-runtime/test/client.test.js \
  packages/http-runtime/test/jsonApiTransport.test.js \
  packages/http-runtime/test/jsonApiRouteTransport.test.js
```

The assistant test uses real SQLite and traverses all 205 visible records from
410 seeded rows, including tied timestamps, sparse fields, workspace filtering,
and requested limits 100/200 capped at 100. The host tests include temporal
values, time-zone behavior, mappings, projections, fieldsets, and typed errors.
Several other tests are unit contracts; these 65 passes do not establish all app,
database, permission, or transaction workflows.

Resolution was checked with:

```sh
node --input-type=module -e 'console.log(import.meta.resolve("json-rest-api"))'
```

It resolved to this checkout's `node_modules/json-rest-api/index.js`. These
results exercise the installed dependency, **not** the modified library worktree
or a new API artifact. Exact-artifact paired verification remains M-04/M-13.

## Next migration work

The format/returning contract is implemented and the paired artifact path below
is verified. Complete the remaining usage/workflow inventory, package version
coordination, templates/documentation, and final consumer checks. Recheck the
expansion before each integration. The [API migration guide](../GUIDE/MIGRATING_API_V2.md)
describes implemented worktree behavior; the coordinated release and later
capabilities remain unfinished.

## Scoped repository inventory and exact seed discovery

Snapshot refreshed 2026-09-09. All paths are under `/home/merc/Development/current`.

| Checkout | Branch and commit | Dependency and work boundary | Relevant commands |
| --- | --- | --- | --- |
| jskit-ai | main, `70163546304ee1fed80cbf1c6ec67517294db855` | Host package 0.1.127 depends on json-rest-api ^1.0.29; installed Knex 3.2.10. Unrelated connector expansion and generated catalog/docs/lock edits exist. | Selected five-file Node test command above; `npm run agent-docs:build`; root `npm run verify` for final gates. |
| vibe64 | main, `2cda2afa9e53d64d8abc305b4f48e8cc66b91af0` | Current lock has no json-rest-api or json-rest-api-core; Knex 3.3.0. Unrelated Genesis, integrations, source-editor, routing, package and end-to-end edits exist. | `npm test -- tests/server/vibe64ProjectOnboarding.unit.test.js`; one test file at a time with no overlapping run, per AGENTS. Full verification remains a later gate. |
| seed-jskit | public, `02cf10cef15a2a44b73adf52e5cd60e53b7bf9bf` | Clean; public shell has no json-rest-api, host, or Knex dependency. | `npm test -- tests/server/smoke.test.js`; `npm run verify`. |
| seed-jskit-accounts | accounts, `91dad8e418ada6594001b8282c2b87c41e8fc3e5` | Clean; lock has json-rest-api 1.0.28, host 0.1.125, Knex 3.3.0. Actual database/account workflows require migrated packages and a disposable MySQL database. | `npm test -- tests/server/smoke.test.js`; `npm run db:prepare`; `npm run verify`. |

Vibe64's `packages/vibe64-genesis/src/server/index.js` delegates listing and
application to genesis-compiler. Its installed genesis-stack 1.1.0
`genesis.templates.json` selects `official:jskit/public` and
`official:jskit/accounts`, both from `https://github.com/vibe64-dev/seed-jskit.git`,
on branches `public` and `accounts` respectively. Both local seed origins match
that URL. These are the exact seed targets, established from vibe64's code and
catalog. The compiler accepts a local repository override for verification;
remote publication is outside the goal. Vibe64's
`tooling/verify-new-project-foundation.mjs` exercises the public template through
install, checks, build, and health; final seed verification must select local
migrated source rather than accidentally fetching the old remote branch.

Jskit-ai owns authored CRUD patterns and repository source. Its agent-docs build
produces distributed docs; no obsolete CRUD source generator was found. Seeds
contain ordinary application source and use installed jskit tooling for checks.
Read each checkout's current AGENTS and revalidate its state before edits.
Vibe64 and both seeds use Node 26; jskit-ai also permits 22/24.

## Actual worktree package verification

`scripts/check-consumer-package.js` packs this worktree, installs that tarball
and the consumer's exact Knex peer into a temporary directory, and selects that
package for imports during an explicit consumer command. It prints package
resolution, version, SHA-256, integrity, Node version, and command. It leaves
consumer dependency files untouched and removes the temporary installation.
This selects test artifacts; it does not translate API calls.

```sh
node scripts/check-consumer-package.js \
  --consumer /home/merc/Development/current/jskit-ai -- \
  node --test packages/json-rest-api-core/test/entrypoints.boundary.test.js \
  packages/crud-core/test/assistantPagination.integration.test.js \
  packages/http-runtime/test/client.test.js \
  packages/http-runtime/test/jsonApiTransport.test.js \
  packages/http-runtime/test/jsonApiRouteTransport.test.js
```

Executed on Node 26.5.0: **65/65 passed**, no failures/skips, 2.308 seconds of
test time. The packed library was version 1.0.29, SHA-256
`679531b05a67fe9384b51d292017d21e956cb72e59c5d84465e4cd466514c935`.
This is evidence for that pre-migration worktree artifact, not the future API.
A deliberate consumer exit 7 propagated failure; SIGTERM stopped a test and its
spawned descendant; both cases removed temporary installs.

The same runner passed vibe64's targeted onboarding file: **11/11**, 8.622
seconds. That workflow does not currently call json-rest-api. The accounts seed
smoke passed **1/1**, 4.839 seconds, with the worktree library selected, but its
MySQL version probe was denied for the unprovisioned disposable test account.
Its successful health/anonymous-session responses do **not** prove database CRUD
or an account migration. The public seed's native smoke passed **1/1**, 1.810
seconds; it has no library dependency to replace.

At this baseline the runner selected the library only. Selecting migrated jskit-ai
package artifacts in the accounts seed was still necessary for M-04/M-13. No
consumer source, manifest, lockfile, or installed dependencies were modified by
these baseline checks.

## First source migration to the new API

The host now installs RestApiPlugin with `format: "plain", returning: "full"`.
The shared CRUD repository selects JSON:API explicitly. User/workspace query
calls select plain format; their existing explicit inputRecord and transaction
forwarding remain. The user repository forwarding assertions now check the
new option name. Nine maintained JS files changed; they passed the consumer's
ESLint. No unrelated expansion changes, dependency files, or installed modules
were modified. The temporal wrapper remains pending a separate responsibility
audit.

The five-file package check above plus
`packages/users-core/test/repositoryContracts.test.js` passed **73/73**, no
failures/skips, against the new worktree runtime on Node 26.5.0 (11.170 seconds).
The library artifact still carries the pre-release-worktree version 1.0.29;
it must not be published under that existing version. The coordinated breaking
version/dependency update is still open. In particular, the accounts seed's
installed older host cannot use the new options until its jskit-ai package
graph is selected and verified.

## Paired packaged-library and packaged-jskit verification

The runner now accepts `--jskit PATH` for seeds and other applications. It copies
the application into a disposable directory, uses jskit-ai's existing
`currentJskitWorkspaces.mjs` staging/version helpers, and replaces the required
jskit package cohort with extracted **actual npm tarballs**. It packs the current
library too. Only disposable manifests/lockfiles select these versions; the
source checkouts and their installed dependencies are preserved.

```sh
node scripts/check-consumer-package.js \
  --consumer /home/merc/Development/current/seed-jskit-accounts \
  --jskit /home/merc/Development/current/jskit-ai -- npm run verify

node scripts/check-consumer-package.js \
  --consumer /home/merc/Development/current/seed-jskit \
  --jskit /home/merc/Development/current/jskit-ai -- npm run verify
```

This mode uses ordinary npm workspace resolution without an import hook. Before
the selected command starts, it asserts every required jskit package resolves to
its staged artifact and the host resolves to the installed library tarball.
The log includes Node/version information, library integrity and SHA-256, and
the version/SHA-256 of each jskit artifact. Missing current jskit packages fail;
the existing helper's registry sentinel prevents a silent fallback to published
jskit packages. Other dependencies are installed normally from the application
lock and manifests.

Candidate workspaces live under `test-results/.jskit-candidate-packages`:
`test-results` already belongs to each seed's ESLint ignores, while the hidden
child prevents Node's automatic app-test discovery from collecting dependency
tests. Earlier staging locations incorrectly exposed dependency source to app
lint or test discovery. The runner's placement was corrected; neither seed's
verification rules were relaxed. Timeout/interruption removes the temporary
install, and command failures propagate. No runtime API translation is added.

The library-only mode remains useful for tests in the jskit-ai checkout. The
earlier vibe64 resolution check and both seed checks establish M-04's selectable
artifact path. Vibe64 and the public seed currently have no library dependency
in their workflows; adding it to the isolated check does not establish database
integration in those applications. Final migration/version and whole-workflow
checks remain M-08–M-14.

## Real database workflow exposed mixed-format writes

Selecting the current library and **21 current jskit package artifacts** in the
accounts seed exposed an incomplete source migration: six user/workspace
repositories still built JSON:API input documents while expecting plain output.
The old plain-input autodetection had hidden this combination. Passing earlier
mock/host tests did not prove these actual writes worked.

Those repositories now send plain `inputRecord` fields directly with explicit
`format: "plain"`. PATCH IDs stay in the outer options; relationships use plain
IDs. Their unused JSON:API builders/imports were removed. Workspace owner writes
also remove the raw owner foreign-key field before assigning the relationship.
The shared CRUD repository continues to use explicit JSON:API documents. The
[migration guide](../GUIDE/MIGRATING_API_V2.md) includes this mixed-format pitfall
and before/after examples.

All **352 tests** in the four affected packages passed against the packaged
library on Node 26.5.0: users-core 43, workspaces-core 142, crud-core 144, and
json-rest-api-core 23; zero failures/skips. The narrower repository run passed
29 tests. All 13 changed consumer JS files passed the owning ESLint configuration.
These are package test results, not proof of every workspace database workflow.

The accounts seed now owns `tests/server/account-persistence.integration.js` and
an explicit `npm run test:database` command. It prepares migrations and exercises
registration, JSON:API profile updates, persistence across logout/login,
anonymous/wrong-password rejection, and two independent users' settings through
the real server. Supply `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and the matching
`DB_PASSWORD` for a dedicated disposable database, then run:

```sh
node scripts/check-consumer-package.js \
  --consumer /home/merc/Development/current/seed-jskit-accounts \
  --jskit /home/merc/Development/current/jskit-ai -- npm run test:database
```

This passed **1/1**, zero failures/skips, in **4.821 seconds**, using a freshly
initialized, user-owned **MariaDB 12.0.2** instance on an allocated loopback port.
The instance was stopped and its private data directory removed afterwards.
Provisioning was local test setup; the runner expects the explicit database
environment and does not create or modify an existing server itself. This is
real MySQL-protocol persistence and real Fastify request injection; it does not
claim Oracle MySQL/PostgreSQL coverage, browser end-to-end coverage, or coverage
of the library's separate Fastify connector.

The public seed has no authoritative source changes. Accounts seed changes are
the integration test, its package script, and reproduction instructions in its
README. No consumer dependency declarations, lockfiles, or installed packages
have been ported in place yet. The source-revision inventory above is unchanged;
unrelated jskit-ai/vibe64 expansion work remains untouched.

## Full seed verification of the paired artifacts

Both commands above completed successfully on Node 26.5.0. Public used five
current jskit artifacts; accounts used 21. Both selected the same library
worktree tarball, still carrying version 1.0.29 before coordinated release work,
with SHA-256 `f99a6a75e6db5d13bb9df0576917ade2933c92c4f7057c3ff95b96226844bd89`.
This hash identifies the tested snapshot, before this evidence entry was added;
subsequent documentation changes alter the packed artifact. It is not a release
version or authorization to publish under 1.0.29.

| Seed | Package check | Lint | Server tests | Client tests | Build |
| --- | --- | --- | --- | --- | --- |
| Public | pass | pass | 1 passed, 0 failed/skipped; 1.358 s | 1 passed | pass; 1.89 s |
| Accounts | pass | pass | 1 passed, 0 failed/skipped; 2.430 s | 1 passed | pass; 2.21 s |

The account persistence integration test is the separate explicit command above;
the default server smoke does not require a provisioned database. These small
seed suites do not replace broader workflow/browser coverage. Both checkers
exited zero, verified unchanged source dependency fingerprints, and removed their
temporary installs. M-04 is complete; coordinated migration acceptance M-13 and
final dependency/version preparation M-14 remain open.
