# Coordinated breaking release

This procedure covers json-rest-api, its jskit-ai host and repositories, vibe64,
and the seeds selected by vibe64's current code. Other applications are migrated
by their maintainers using the [API migration guide](../GUIDE/MIGRATING_API_V2.md).
The [master checklist](../../library-improvement-plan.md) determines readiness;
this procedure does not waive unfinished acceptance criteria.

**Consumer work is currently paused.** Do not apply the parked migration or run
consumer commands below until the maintainer resumes that work. Publishing and
deployment are outside the active implementation goal. No release version or
registry tag has been reserved or published by writing this procedure.

## 1. Reconcile source and dependency owners

- Record branch, commit and working changes in each authorized repository. Read
  its current contributor instructions and preserve unrelated expansion work.
- Refresh the actual imports and calls, including generators, templates, tests,
  manifests, locks and documentation. The [consumer inventory](consumer-migration.md)
  is historical evidence, not a complete map of today's expansion.
- Reconcile the [parked 13-file patch](pending-jskit-ai/README.md) with current
  source and final API contracts. Check it before applying; port conflicts by
  intent, never by restoring whole historical files. It is only a first batch.
- Rediscover seed locations from vibe64's code. Migrate the selected seeds and
  generated projects, not unrelated templates. Retire the parked patch only
  after every change is integrated or explicitly superseded with evidence.
- Resolve pending upstream dependency fixes before promising their behavior in
  a release. In particular, saved hooked-api patches are not installed fixes.
  Verify the resolved dependency version and behavior, not just its manifest range.

## 2. Select versions and migrate together

The current worktree still identifies itself as 1.0.29 despite breaking changes.
Do not publish these changes under that version or as an ordinary 1.x patch.
Select a new major version and, if needed, a prerelease version/tag with the
maintainer. Check the registry at release time for availability and current tags.

Keep the release/version change separate from unrelated implementation work.
Update the library's package manifest and lockfile together using the selected
version, without automatically creating a Git tag. Rebuild the artifact after
the version edit; a tarball tested before that edit is not the final artifact.

In the same migration batch, update jskit-ai's host dependency and all affected
repository calls, hook contracts, transaction ownership, imports and declarations.
Use an exact candidate version during acceptance. Update the affected jskit-ai
package versions and internal dependency ranges using that repository's release
tooling. Then update vibe64/selected-seed dependencies and locks to those packages.
Do not add compatibility forwarding paths or retain obsolete overloads merely
to allow unmigrated callers to pass. Review generated changes through their
generators, including generated projects' dependency manifests.

Local `file:` overrides are temporary test arrangements. Published manifests and
committed release locks must resolve the intended registry versions and integrity
values, with no workstation paths or accidental fallback to the old 1.x library.

## 3. Verify the library and actual package

Use Node 24 as pinned in `.nvmrc`; no Node 26 repeat is required. Install cleanly
and run the following from the library root with the documented native server
prerequisites available:

```sh
nvm use
npm ci
npm run verify
npm run test:clean-package
npm run test:databases
npm run test:redis
```

`verify` includes packed declarations/imports/file contents, internal types,
SQLite suites, query budgets, Express 4, lint and docs. It does not subsume native
database or clean-install checks. `test:clean-package` installs a freshly packed
library without development/optional dependencies, verifies optional-peer loading,
then installs Knex/SQLite and exercises storage. Its temporary installation is
removed afterward; retain the command's artifact hash and dependency report.

For documentation changed since its last executed-example check, run the relevant
commands in [tests/README.md](../../tests/README.md), including the native tutorial
and migration-guide commands where applicable. Record their exact scope. Build
and inspect the final package after all documentation/declaration changes.

The [Verify workflow](../../.github/workflows/verify.yml) runs Node 24 library,
native database/Redis and clean-package jobs. Its aggregate `Verification` check
requires all three job groups; a skipped or failed group cannot produce success.
Hosted CI results must be checked for the release commit. Local passes establish
local evidence, not a claim that GitHub Actions ran successfully.

## 4. Verify migrated consumers against exact artifacts

After consumer work resumes, first reconcile the checker's assumptions against
the current jskit-ai workspace tooling. The existing checker accepts:

```text
node scripts/check-consumer-package.js --consumer PATH -- COMMAND [ARGS...]
node scripts/check-consumer-package.js --consumer APP_PATH --jskit JSKIT_PATH -- COMMAND [ARGS...]
```

Supply each repository's actual verification command. The direct consumer mode
installs the tarball in a temporary directory and uses a Node resolution hook
to select it while running the command in the consumer checkout; it does not
replace the checkout's installed dependency. The paired app mode stages current
jskit-ai artifacts in a temporary app copy.
These checks execute consumer commands and are not read-only operations. Review
the runner and current repository instructions before using them.

Verify package resolution from the host and app, not just from the library root.
Record library and jskit-ai artifact hashes, consumer revisions, Node version,
commands, results and any omissions. Then exercise the complete migrated flows:
CRUD/plain and JSON:API responses, pagination, scoped access, user/workspace
repositories, managed transactions and error handling, required file/event flows,
and the accounts seed's database-backed persistence. Run vibe64's actual selected
seed-generation/install/build/health workflow with those candidates. An installed
old package, a mocked repository or a public seed that never calls json-rest-api
does not prove the migrated contract.

Use disposable databases for data-migration checks. Verify defaults/backfills,
canonical field maps and stored records as specified in the migration guides.
Test a clean install from the updated locks, and compare dependency diffs for
unrelated upgrades. Complete Part M and the final review passes before declaring
the coordinated migration ready.

## 5. Publish and promote only after acceptance

Prepare a reviewable release record containing selected versions, immutable
tarball hashes/integrities, release notes, the API/data migration instructions,
all required checks and known limitations. Confirm publication authorization
separately; a green check does not itself authorize publishing or deployment.

Publish in dependency order: required upstream fixes, json-rest-api, affected
jskit-ai packages, then the selected downstream release artifacts. If using
prereleases, keep the candidate on the chosen non-default tag until the consumer
checks pass against registry-installed packages. Check that the registry artifact
matches the tested package and verify host/app resolution again after installation.
Create release tags for the accepted source revisions through each repository's
normal process, and promote only the accepted versions.

If acceptance fails, keep the previous release available and fix a new candidate.
Do not overwrite an already published version or treat changing a registry tag
as a database rollback. Before deployment, prepare recovery for the actual data
migrations: old code may not understand migrated data. Restore from a verified
backup or use a reviewed forward correction as appropriate. Deployment, production
backups and recovery execution are separate from this library implementation goal.
