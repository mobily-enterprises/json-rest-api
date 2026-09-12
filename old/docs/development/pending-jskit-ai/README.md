# Parked jskit-ai API migration

## Current source preparation, 2026-09-12

[v2-source-preparation.patch](v2-source-preparation.patch) captures the current
**42-file** source port against jskit-ai `70163546304ee1fed80cbf1c6ec67517294db855`.
Its [manifest](v2-source-preparation-manifest.json) records base/prepared hashes,
the required library worktree, ownership snapshot and deferred dependencies.
The temporary clone has been removed. Active jskit-ai/integrations, Vibe64 and
seeds were not edited. Consumer checks have not run; subsequent library
verification is recorded in [preparation status](preparation-status.md).

This patch supersedes the intent of the older 13-file patch below. **Do not apply
both.** It includes the host, CRUD/user/workspace repositories, managed owners,
duplicate handling, HTTP/client outcomes, post-commit failures and authored tests.
It deliberately excludes manifests, lockfiles, catalog and generated docs.

Before landing, refresh the active integrations diff and reconcile dependencies
and generated outputs as described in [preparation status](preparation-status.md).
In particular, json-rest-api-core must select v2 and remove hooked-api, crud-core
now needs a direct v2 dependency for `RestApiWriteError`, and engines must reflect
Node 24+. The patch is not independently runnable against current v1 dependencies.

From this library's root, a later static applicability check is:

```sh
git -C ../jskit-ai apply --check "$PWD/old/docs/development/pending-jskit-ai/v2-source-preparation.patch"
```

Review conflicts against the new source; do not restore whole archived files
over current work. A clean patch check does not establish runtime compatibility.
Consumer checks and generators remain deferred until the integration checkpoint.

## Historical first batch

For the newly authorized v2 preparation batch, current ownership boundaries and
explicitly deferred tests, read [Current preparation status](preparation-status.md).
The older patch and capture evidence below remain intact.

The maintainer requested that this unfinished migration live in json-rest-api
instead of a separate worktree or the active jskit-ai checkout. The library
implementation goal has resumed, but consumer work remains paused. Do not apply
this migration to jskit-ai, vibe64 or their seeds until the maintainer resumes
consumer work.

`migration.patch` preserves the exact changes to the 13 jskit-ai files listed in
`manifest.json`. It includes full Git blob IDs and all changes to those files:
the host's `format`/`returning` configuration, repository call options, plain
input records and relationship IDs, removed JSON:API builders, and updated test
expectations. This is a first migration batch, **not the complete jskit-ai port**.

Base: jskit-ai `main` at
`70163546304ee1fed80cbf1c6ec67517294db855`. The manifest records each base and
migrated file's SHA-256, the base Git blob IDs, the patch checksum, and the
capture/removal verification. Patch SHA-256:
`81c454022208ba2c1bc8d2a893a4e3eb9d7d5c8b09d8e86a4bf435ea9b6e2d3e`.

The patch was applied to temporary copies of all 13 base files and reproduced
the migrated contents byte for byte. Reversing it reproduced all base files.
The temporary verification directory was removed. There is no parked worktree
or Git stash to recover separately.

After removal, the five affected repository test files passed **29/29 tests**
on Node 26.5.0 with zero skips. This verifies those restored repository contracts,
not the whole application or its compatibility with the unpublished library.
The manifest records the exact command and result.

## Resume as part of the complete migration

1. Resume consumer work only when the maintainer requests it. Refresh jskit-ai's
   branch, working changes, dependencies and new call sites first.
2. Read this patch and compare its intent with current source and the final
   library contracts. Keep the ongoing expansion's changes.
3. From the json-rest-api repository root, check whether the patch still applies:

   ```sh
   git -C ../jskit-ai apply --check "$PWD/old/docs/development/pending-jskit-ai/migration.patch"
   ```

   After reviewing the affected paths, apply with `git apply` using the same
   arguments without `--check`, or port the changes manually if the files have
   evolved. Do not restore whole old files or force a patch across conflicts.
4. Complete the remaining Part M/B0 work alongside later transaction, error,
   typing and API changes. Reconcile documentation/generated examples, remove
   verified workarounds, update dependency versions/locks, and run the paired
   jskit-ai/vibe64/seed workflows against the intended artifacts.
5. Verify the new combined migration. The earlier 353 passing package tests
   applied to this captured source and the library tarball recorded in the
   manifest; they do not establish a complete migration or current-checkout
   compatibility after this patch has been parked.
6. Update the master checklist and evidence. Retire this patch only after all
   its changes have been integrated or explicitly superseded with evidence.

The archive covers only these 13 files. Other jskit-ai expansion changes, its
lockfile and generated documentation, vibe64, and the accounts seed are outside
this parking operation. The source manifest records successful preservation
checks after removal from jskit-ai.
