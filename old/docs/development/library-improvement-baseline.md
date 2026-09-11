# Library improvement baseline

Recorded on 2026-09-08 against `51302ce` (`1.0.29`). This is the starting
compatibility reference for `library-improvement-plan.md`, not a claim that all
listed capabilities have integration coverage.

## Checkout and environment

The checkout initially contained only the newly created, untracked improvement
plan. The prior corrective work is committed in `24ea75e`; `51302ce` subsequently
changes the package version. No existing local changes were replaced.

The shell selects Node 26.5.0, but the existing better-sqlite3 native module was
built for Node 22. Baseline commands used Node **22.16.0** explicitly. Switching
Node versions requires installing native dependencies for that runtime; a native
ABI failure is not a library test result.

Installed versions: hooked-api 1.0.24, json-rest-schema 1.0.17, Knex 3.1.0,
better-sqlite3 11.10.0 (SQLite 3.49.2), Express 5.1.0, jose 6.2.2,
Socket.IO 4.8.1, ESLint 9.37.0. json-rest-schema and Express require at least
Node 18; Knex requires at least 16. These lower bounds alone do not establish
this project's supported/tested Node range. A1-01 establishes that separately.

## Baseline verification

Run from the repository root with Node 22.16.0 on PATH:

```sh
npm test
npm run test:anyapi
npm run lint
npm run docs
```

| Command | Tests | Pass | Fail | Skipped tests | Duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| `npm test` | 486 | 485 | 0 | 1 | 24.298 s |
| `npm run test:anyapi` | 483 | 482 | 0 | 1 | 23.477 s |
| `npm run lint` | — | success | 0 | — | — |
| `npm run docs` | — | success | 0 | — | Jekyll generation 6.946 s |

Both test runs report 188 suites. TAP additionally marks entire mode-specific
suites skipped; the test totals do not enumerate those missing capabilities.
The regular-mode skipped test checks AnyAPI cursor-fixture cleanup. The AnyAPI
skipped test checks custom serialization for writes and filters. AnyAPI cursor
and custom-ID suites are not run in regular mode. These are coverage differences,
not evidence that all backend capabilities are equivalent.

At baseline `verify` runs only ID-focused tests and docs. Lint excludes all tests,
examples, docs and dependencies; scripts and runtime code are included. An explicit
test/script lint run found 125 errors: 81 unused variables/imports, 42 layout/quote
findings and two dynamic Function constructions used to execute generated migrations.
Documentation builds with the local Ruby/Bundler installation and `docs/Gemfile.lock`.

## Reconciliation with earlier audits

`fixing_plan.md` records completed custom-ID/PUT parity, serializer, relationship
cardinality/authorization, transaction-hook, upload, URL, error and response fixes.
The later `24ea75e` adds temporal contracts, cursor and fieldset normalization and
their regressions. Preserve those implementations and tests.

`SINGLE_VALIDATION_CONTRACT_TODO.txt` has stale statements that relationship-route
contracts remain separate/pending. The three relationship write methods now call
`validateRelationshipRoutePayload` in `common.js`, backed by `request-contracts.js`.
Do not create another payload validator to satisfy that old text. The historical
trackers remain historical; this plan is the current work list.

## Public compatibility inventory

### Imports

`index.js` exports 22 named symbols and no default export:

- Plugins: `RestApiPlugin`, `RestApiKnexPlugin`, `RestApiAnyapiKnexPlugin`,
  `AutoFilterPlugin`, `RowPolicyPlugin`, `QueryProjectionsPlugin`,
  `FileHandlingPlugin`, `CorsPlugin`, `LabelPlugin`, `SocketIOPlugin`,
  `ExpressPlugin`, `FastifyPlugin`.
- Storage classes: `LocalStorage`, `S3Storage`.
- Errors: `RestApiPayloadError`, `RestApiResourceError`, `RestApiValidationError`,
  `RestApiFieldsetError`, `RestApiTemporalDataError`.
- Constants: `REST_API_FIELDSET_ERROR_CODE`, `REST_API_TEMPORAL_DATA_ERROR_CODE`.
- Helper: `getUrlPrefix`.

No package `exports` map currently restricts deep imports. Preserve shipped runtime
paths under `plugins/` and `lib/`, as well as `index.js`. Guides explicitly import
`plugins/core/bulk-operations-plugin.js`, `plugins/core/connectors/express-plugin.js`,
`plugins/storage/local-storage.js` and `plugins/storage/s3-storage.js`.
`GUIDE_3_Field_Transformations.md` also has stale default-import examples for the
two core plugin modules, whose actual exports are named. Fix those examples in A10;
do not introduce default exports to match a documentation error.

### Calls, declarations and formats

`RestApiPlugin` supplies the `resources`/`addResource` aliases, API methods
`addRoute` and `release`, and resource methods `query`, `get`, `post`, `put`,
`patch`, `delete`, `getRelationship`, `getRelated`, `postRelationship`,
`patchRelationship`, `deleteRelationship`, `enrichAttributes`, `checkPermissions`
and `applyQueryFilters`. Bulk plugin methods are `bulkPost`, `bulkPatch` and
`bulkDelete`. Hooked-api supplies plugin installation, scopes, hooks and call context.

Resource declarations include `schema`, `relationships`, `tableName`, `idProperty`,
scope options and (with the projection plugin) `queryFields`. Fields can describe
validation, visibility, virtual/computed behavior, getters/setters, relationships
and storage mappings. Do not replace this authored json-rest-schema contract.

Read calls accept an options object with `id` where needed, `queryParams`,
`simplified`, `isTransport` and `transaction`. Query parameters include `filter`,
`fields` (resource-to-comma-separated-string map), `include` and `sort` arrays,
and `page`. Relationship calls additionally use `relationshipName`; writes use
`relationshipData`. Preserve existing route parsers and generated-link forms.

Resource writes accept `inputRecord` (strict JSON:API or simplified according to
configuration), `id` for PUT/PATCH, `returnFullRecord`, `queryParams`, `transaction`
and transport/format overrides. Simplified writes also accept attributes directly
in the first argument. `setupCommonRequest` has an existing special case forcing
simplified input when no `inputRecord` is provided. Nested calls propagate context
through hooked-api's second call argument. Preserve auth and extension data there.

Strict results use JSON:API `data`, attributes, relationships, links, meta and
included resources. Simplified reads/write returns use the established plain
record/collection transformations. Full write returns invoke GET; minimal returns
contain the resource identifier in the selected representation; no-return writes
and DELETE resolve `undefined`. Keep existing error classes/codes and connector
status/header mappings.

### Defaults and precedence

| Setting | Existing default/precedence |
| --- | --- |
| Programmatic format | simplified (`simplifiedApi: true`) |
| Transport format | strict (`simplifiedTransport: false`) |
| Write return | API `full`; transport `no` |
| Return aliases | `true` → `full`; `false` → `no`; string modes and per-method objects supported |
| Per-call overrides | `simplified` and `returnFullRecord` override scope/global defaults |
| Scope defaults | Scope vars override plugin vars through hooked-api's cascading proxy |
| Identifier | `idProperty: 'id'`; customizable `normalizeId` |
| Query limits | default 20, maximum 100; include depth 3 |
| Fields/includes | empty map/array unless requested; sort may use resource `defaultSort` |
| Transaction | supplied transaction is borrowed; otherwise write creates one when a helper exists |

`enablePaginationCounts` is initialized using `option || true`, so explicit global
`false` is currently lost. This is a candidate correctness fix for A2/A5, requiring
a regression and separate documentation from a behavior-preserving refactor.

## Storage and connector capability inventory

| Area | Regular Knex | AnyAPI Knex | Baseline evidence/limits |
| --- | --- | --- | --- |
| Physical layout | Resource tables, snake-case/explicit columns | Tenant/resource canonical records, typed slots, canonical links | SQLite full suites |
| IDs | Logical/custom ID property, schema-driven normalization | Logical IDs distinct from canonical row IDs | Dedicated ID/PUT tests |
| Values | Column translation, custom serializers, driver normalization | Slot translation, query-builder proxy, driver normalization | AnyAPI custom serializer case explicitly skipped |
| Temporal | date/dateTime/time/epoch contracts; migration precision | Temporal types share date slots declared with `dateTime` | SQLite only; real driver precision/time-only behavior unverified |
| Relationships | Foreign keys/pivot tables, includes and polymorphism | Canonical belongs-to/link metadata plus query adapters | Both SQLite suites; batching/tenant isolation need stronger cases |
| Schema lifecycle | Creation, introspection, migration and diff helpers | Canonical schema creation/registry; alterations have explicit limits | SQLite tests and SQL-generation checks are not real-driver evidence |
| Query extensions | Knex builders and custom hooks | Proxy interception for joins, aliases, callbacks, aggregates and predicates | A6 must define/test the supported proxy surface |

Database capability and schema helpers contain PostgreSQL (`pg`), MySQL
(`mysql`/`mysql2`), SQLite and some MSSQL branches. The initial standard suite runs
in-memory better-sqlite3 only. A3 must establish real PostgreSQL/MySQL behavior for
each storage mode; no new MSSQL compatibility claim follows from branch presence.
AnyAPI index probing uses the SQLite schema name `main`; investigate this on real
drivers before claiming cross-driver schema compatibility.

Express advertises majors 4 and 5; the installed and tested major is 5. Fastify
parity currently uses a hand-written fake, not the real package. Curl and Socket.IO
tests use actual local HTTP servers; curl initially binds fixed port 3456. Multipart
detector and cancellation coverage still require real parsers. `S3Storage` explicitly
rejects real unimplemented operations; retain its explicit mock-mode distinction.

## Lifecycle map

Source reference: `plugins/core/rest-api-plugin-methods/`, the shared `common.js`,
and storage/include helpers. This is the structural baseline; A4 adds exact traced
invocation counts, context contents and failure traces before extracting code.

| Operation | Structural sequence |
| --- | --- |
| Query | Resolve/validate query contract → permission checks → fieldset validation → `beforeData`, `beforeDataQuery` → storage query/includes → data permissions/enrichment/computed fields → finish hooks → final normalization/format |
| GET | Resolve contract/ID → minimal lookup and permissions → `beforeData`, `beforeDataGet` → storage read/includes → data permissions → record/attribute/relationship enrichment → `finish`, `finishGet` → final normalization/format |
| POST | Common setup/transaction → `beforeProcessing`, `beforeProcessingPost` → contract/schema and relationship validation/permissions → before-data hooks → setters → insert and assign ID → after-data hooks → many-to-many writes → response preparation/finish → owned commit/`afterCommit` |
| PATCH | Setup/processing → partial validation, relationship validation, existing-record lookup/permissions → before-data hooks → setters → update → after-data hooks → provided relationship changes → response/finish → owned commit/`afterCommit` |
| PUT | Setup/processing → determine create/update, replacement validation/permissions and omitted relationships → before-data hooks → setters → storage PUT → after-data hooks → relationship replacement → response/finish → owned commit/`afterCommit` |
| DELETE | Setup/transaction → minimal lookup/permissions → before-data hooks → record context/delete → after-data hooks → `finish`, `finishDelete` → owned commit/`afterCommit` |
| Relationship GET | Relationship validation/permission hooks → nested resource GET with include → extract linkage |
| Related GET | Relationship validation/permissions → type-specific nested GET/query/include or per-ID fallback → related representation |
| Relationship writes | Setup/transaction → payload/cardinality validation and permissions → parent/related access checks → type-specific link/FK changes (including nested PATCH where applicable) → general/method finish → owned commit/`afterCommit` |

For POST/PATCH/PUT, the shared schema helper runs general then method-specific
before-schema hooks, and method-specific then general after-schema hooks. The
repeated data sequence has general then method-specific before hooks, setters,
storage, and method-specific then general after hooks. IDs, normalized attributes,
minimal records, auth, schema and transaction are hook-observable context.

`handleRecordReturnAfterWrite` refreshes minimal data when possible, handles
no/minimal/full returns and finish hooks. Full returns call resource GET with the
existing transaction/context before write finish hooks. Thus full writes also
invoke read authorization/enrichment/finish hooks. Final normalization after
finish hooks prevents native/invalid temporal values escaping via hooks.

`commitOwnedTransaction` commits only owned transactions, sets
`context.transactionCommitted`, then awaits `afterCommit`. A post-commit hook error
rejects the call despite persisted data. `handleWriteMethodError` rolls back owned,
not-acknowledged-committed transactions and runs `afterRollback`, then logs/rethrows.
Rollback, rollback-hook or logging errors can currently replace the primary error;
A7 addresses this with independent failure tests.

Caller-owned transactions are not completed by individual resource methods.
Bulk atomic calls create a transaction and lend it to per-item methods; bulk
currently performs commit/rollback directly, without the shared completion hooks.
This must be covered before changing lifecycle code or documenting event guarantees.
Non-atomic bulk invokes individual writes and accumulates per-item results/errors.

File handling processes uploads at `beforeProcessing` and cleans tracked uploads
at `afterRollback`. Socket.IO registers broadcasts at `finish`, queues them by
transaction, flushes at `afterCommit` and clears at `afterRollback`. Borrowed/bulk
transactions therefore need explicit completion/event coverage in A7/B2.

## Representative query and package measurements

`scripts/measure-query-baseline.js` creates one country, one publisher, three
authors and ten books, each linked to those three authors, through the shared
fixture/public API. It counts Knex `query` events only during each measured call,
checks returned record counts and always closes the database. Run separately:

```sh
node scripts/measure-query-baseline.js
JSON_REST_API_STORAGE=anyapi node scripts/measure-query-baseline.js
npm pack --dry-run --json
```

| Shape | Returned/included | Regular statements | AnyAPI statements |
| --- | --- | ---: | ---: |
| Flat books query | 10 / 0 | 2 | 3 |
| Sparse title field | 10 / 0 | 2 | 3 |
| Publisher.country + authors includes | 10 / 5 | 6 | 9 |
| One book's three related authors | 3 / 0 | 11 | 15 |

These are statement counts, including counts/metadata lookups, not just main SELECTs.
The script also reports elapsed time and heap delta for observation, with no flaky
timing threshold. Initial elapsed measurements were 2.794–9.641 ms and heap deltas
0.46–1.31 MB; process warmup and GC affect them. A8 extends shapes, scale and budgets.
The regular related-author path also logs an unknown `authors` include on the pivot
resource before returning the correct three records; investigate under A6/A8.

Package dry run after adding the plan but before implementation: **219 entries**,
**564,419 bytes packed**, **2,653,339 bytes unpacked**. Contents include 87 plugin
files, four lib files, 61 test files, 42 docs files, four scripts, three `.claude`
files, agent instructions, old trackers, debug scripts and the new plan. A10 must
remove development-only contents while preserving runtime deep imports. This
measurement includes the plan's content and must not be compared as a code-only
size change.
