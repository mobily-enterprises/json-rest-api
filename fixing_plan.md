# Fixing Plan

Checklist-style plan for addressing the audit findings. Items marked as requiring approval change public behavior, public API, or dependencies.

## High Priority

- [x] Fix AnyAPI custom `idProperty` canonical mapping.
  - [x] Treat `schemaInfo.idProperty` as an alias of logical `id` in the canonical storage adapter.
  - [x] Skip custom id fields such as `item_id` when building DB attribute selections.
  - [x] Ensure cursor, sort, projection, sparse fieldset, and include paths translate both `id` and `idProperty` to `logical_id`.
  - [x] Add AnyAPI tests for custom-id `post`, `get`, `query`, sparse fields, and cursor pagination.

- [x] Fix AnyAPI PUT create parity.
  - [x] Branch `helpers.dataPut` on `context.isCreate`.
  - [x] In create mode, insert into `any_records` with tenant, resource, logical id, and translated attributes.
  - [x] Keep the current update path for update mode.
  - [x] Add legacy Knex and AnyAPI parity tests for `PUT /resource/:id` create, including custom IDs.

- [x] Fix pagination link query-string round trips.
  - [x] Replace manual query-string concatenation with one serializer that is the inverse of `parseJsonApiQuery`.
  - [x] Use `URLSearchParams` for keys and values.
  - [x] Map internal `queryParams.filters` back to public JSON:API `filter[...]`.
  - [x] Add tests that parse generated `links.next` and prove filters, fields, sort, include, and page params survive round trip.

- [x] Fix relationship PATCH cardinality validation.
  - [x] Generate relationship-aware request contracts from relationship metadata.
  - [x] Allow to-one relationship PATCH data to be `null` or one resource identifier only.
  - [x] Allow to-many relationship data to be arrays only.
  - [x] Make `processRelationships()` throw when a belongsTo relationship receives an array.
  - [x] Add API and transport tests for invalid to-one arrays and invalid to-many scalars.

- [x] Run `afterCommit` for relationship routes.
  - [x] After `postRelationship`, `patchRelationship`, and `deleteRelationship` commit their own transaction, run `afterCommit`.
  - [x] Preserve rollback behavior through `afterRollback`.
  - [x] Verify Socket.IO deferred relationship broadcasts work, or define a separate relationship notification policy.
  - [x] Add tests with an `afterCommit` hook counter and Socket.IO relationship-write subscription behavior.

- [x] Decide and fix post-commit hook failure semantics.
  - [x] Split transaction work from post-commit side effects.
  - [x] Once `commit()` succeeds, do not call rollback handling.
  - [x] Surface post-commit hook errors while preserving already-committed data.
  - [x] Add tests proving the row remains committed and the response/error semantics are intentional.

## Medium Priority

- [x] Fix AnyAPI pagination fixture cleanup.
  - [x] Register `cursor_products` and `cursor_items` with `storageMode.registerTable()` in `createCursorPaginationApi`.
  - [x] Add a focused cleanup test proving `cleanTables(knex, ['cursor_products'])` deletes matching `any_records`.
  - [x] Keep metadata-derived cleanup mappings as a later refactor if a broader helper change is approved.

- [x] Fix file temp and orphan cleanup.
  - [x] Wrap file processing in `try/finally` so detector temp files are cleaned after validation failures.
  - [x] Track successfully uploaded URLs on `context`.
  - [x] On rollback or later write error, call storage `delete(url)` where available.
  - [x] Document `delete(url)` as the rollback-capable storage contract.
  - [x] Add tests for invalid MIME cleanup and post-upload DB/validation rollback cleanup.

- [x] Harden `LocalStorage` path containment.
  - [x] Sanitize or reject custom basenames containing `/`, `\`, drive prefixes, or empty names.
  - [x] Replace `startsWith(resolvedDir)` containment with `path.relative(resolvedDir, resolvedPath)`.
  - [x] Add tests for sibling-prefix traversal such as `../uploads_evil/pwn`.

- [ ] Fix untrusted proxy URL generation. Requires maintainer approval.
  - [ ] Stop trusting `Host` and `X-Forwarded-*` by default for absolute links.
  - [ ] Prefer relative links unless `urlPrefixOverride` or an explicit public base URL is configured.
  - [ ] If forwarded headers remain supported, gate them behind `trustProxy` and allowed host/proto validation.
  - [ ] Add Express and Fastify tests with hostile `Host` and `X-Forwarded-Host` headers.

- [ ] Fix `S3Storage` non-mock behavior. Dependency/public behavior choice requires maintainer approval.
  - [ ] Smallest safe fix: throw a clear "real S3 storage is not implemented" error when `mockMode: false`.
  - [ ] Full fix option: add AWS SDK support and real upload/delete implementation.
  - [ ] Add tests for mock mode and the chosen non-mock behavior.

## Low Priority

- [x] Make field setter errors fail closed.
  - [x] Change setter error handling to throw by default.
  - [x] Do not add an opt-in non-fatal mode without a real use case.
  - [x] Add a rollback test where a setter throws and no row is persisted.

- [x] Normalize return-record boolean compatibility.
  - [x] Create one shared return-record normalizer.
  - [x] Normalize `true -> 'full'`, `false -> 'no'`, and keep valid strings unchanged.
  - [x] Use the shared normalizer in plugin install and per-call setup.
  - [x] Update tests and docs to prefer `'no'`, `'minimal'`, and `'full'` while preserving boolean compatibility.

## Contract Drift

- [x] Fix Socket.IO public exports and docs.
  - [x] Export `SocketIOPlugin` from `index.js`.
  - [x] Fix docs to import `Api` from `hooked-api`, not `json-rest-api`.
  - [x] Remove invalid deep imports such as `json-rest-api/plugins/socketio`, or add formal package subpath exports. Subpath exports require maintainer approval.
  - [x] Add a public import smoke test.

- [ ] Align S3 documentation with implementation.
  - [ ] If real S3 is not implemented, make README and guide text state that the included adapter is mock/demo only.
  - [ ] If real S3 is implemented, update docs and tests to match the production behavior.

- [x] Finish relationship validation contract consolidation.
  - [x] Move relationship-route schemas into the same request-contract surface as resource routes.
  - [x] Do this after the cardinality fix so the centralized contract is correct rather than merely centralized.

## Verification Checklist

- [x] `npm test`
- [x] `npm run lint`
- [x] `npm run test:anyapi`
- [x] `npm run verify`
- [x] Narrow repro for AnyAPI custom `idProperty`
- [x] Narrow repro for relationship route `afterCommit`
- [x] Narrow repro for pagination link round trip
- [x] Import smoke test for public exports
