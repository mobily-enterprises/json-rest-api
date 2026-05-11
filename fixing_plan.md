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

- [ ] Decide and fix post-commit hook failure semantics. Requires maintainer approval.
  - [ ] Split transaction work from post-commit side effects.
  - [ ] Once `commit()` succeeds, do not call rollback handling.
  - [ ] Decide whether post-commit hook errors are surfaced distinctly or logged/collected while returning success.
  - [ ] Add tests proving the row remains committed and the response/error semantics are intentional.

## Medium Priority

- [ ] Fix AnyAPI pagination fixture cleanup.
  - [ ] Register `cursor_products` and `cursor_items` with `storageMode.registerTable()` in `createCursorPaginationApi`.
  - [ ] Add a focused cleanup test proving `cleanTables(knex, ['cursor_products'])` deletes matching `any_records`.
  - [ ] Consider deriving AnyAPI cleanup mappings from API metadata later if a broader helper refactor is approved.

- [ ] Fix file temp and orphan cleanup.
  - [ ] Wrap file processing in `try/finally` so detector temp files are cleaned after validation failures.
  - [ ] Track successfully uploaded URLs on `context`.
  - [ ] On rollback or later write error, call storage `delete(url)` where available.
  - [ ] Document `delete(url)` as the rollback-capable storage contract.
  - [ ] Add tests for invalid MIME cleanup and post-upload DB/validation rollback cleanup.

- [ ] Harden `LocalStorage` path containment.
  - [ ] Sanitize or reject custom basenames containing `/`, `\`, drive prefixes, or empty names.
  - [ ] Replace `startsWith(resolvedDir)` containment with `path.relative(resolvedDir, resolvedPath)`.
  - [ ] Add tests for sibling-prefix traversal such as `../uploads_evil/pwn`.

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

- [ ] Make field setter errors fail closed.
  - [ ] Change setter error handling to throw by default.
  - [ ] Add an explicit opt-in non-fatal mode only if there is a real use case.
  - [ ] Add a rollback test where a setter throws and no row is persisted.

- [ ] Normalize return-record boolean compatibility.
  - [ ] Create one shared return-record normalizer.
  - [ ] Normalize `true -> 'full'`, `false -> 'no'`, and keep valid strings unchanged.
  - [ ] Use the shared normalizer in plugin install and per-call setup.
  - [ ] Update tests and docs to prefer `'no'`, `'minimal'`, and `'full'` while preserving boolean compatibility.

## Contract Drift

- [ ] Fix Socket.IO public exports and docs.
  - [ ] Export `SocketIOPlugin` from `index.js`.
  - [ ] Fix docs to import `Api` from `hooked-api`, not `json-rest-api`.
  - [ ] Remove invalid deep imports such as `json-rest-api/plugins/socketio`, or add formal package subpath exports. Subpath exports require maintainer approval.
  - [ ] Add a public import smoke test.

- [ ] Align S3 documentation with implementation.
  - [ ] If real S3 is not implemented, make README and guide text state that the included adapter is mock/demo only.
  - [ ] If real S3 is implemented, update docs and tests to match the production behavior.

- [ ] Finish relationship validation contract consolidation.
  - [ ] Move relationship-route schemas into the same request-contract surface as resource routes.
  - [ ] Do this after the cardinality fix so the centralized contract is correct rather than merely centralized.

## Verification Checklist

- [ ] `npm test`
- [ ] `npm run lint`
- [ ] `npm run test:anyapi`
- [ ] `npm run verify`
- [x] Narrow repro for AnyAPI custom `idProperty`
- [x] Narrow repro for relationship route `afterCommit`
- [x] Narrow repro for pagination link round trip
- [ ] Import smoke test for public exports
