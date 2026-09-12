# Unused surface audit

Read-only implementation review, 12 September 2026. This report records a bounded cleanup assessment, not an authorization to remove every feature unused by the current consumer. Runtime files, package metadata and consumers were not edited by this audit. No tests were run for these findings. Other agents may apply the recommendations separately.

## Scope and limits

Searched active source, tests, declarations, scripts, documentation and examples for the named helpers and dependencies, excluding dependency trees, generated documentation and historical `old/` reports. Followed the live alternatives in field selection, storage mapping, relationship filtering and pagination. Inspected the installed Knex schema implementation for `hasIndex` and the current JSKIT host's imports and plugin installation.

The four exported utility candidates below are not exports of `index.js` or declared public resource methods. They are nevertheless technically reachable by deep import: the package ships `plugins/**/*.js` and has no restrictive `exports` map. Absence of a local caller does not prove absence of arbitrary external deep imports. Their removal is reasonable for this version-zero API cleanup; no compatibility layer is warranted.

## Dependency cleanup

| Dependency | Active use found | Recommendation |
| --- | --- | --- |
| `semver` | No source, documentation, example, script or test import; previously a direct dependency. | Remove the unused direct dependency. |
| `raw-body` | No active import; previously an optional peer and optional-peer metadata entry. | Remove both obsolete metadata entries. |
| `jose` | `tests/socketio.test.js` imports `SignJWT`; `tests/fixtures/api-configs.js` imports `jwtVerify` for test authentication. No library runtime import. | Retain the dev dependency; remove the runtime optional peer and its metadata entry. |

The coordinator reports that these exact package changes and an offline lockfile refresh have now been applied, without dependency version changes. Generic authentication hooks remain useful; a JWT package used by one application's hook need not be this library's peer dependency.

## Small runtime cleanup candidates

| Candidate | Actual callers and live alternative | Assessment |
| --- | --- | --- |
| `createRequiredIndexes`, `plugins/core/lib/querying/knex-cross-table-search.js` | No active caller or regression. Explicit schema/table operations create indexes through `dbTablesOperations.js`; canonical bootstrap uses `schema-utils.js` and `hasKnexTableIndex`. | Remove. It is unused automatic DDL machinery with incorrect assumptions, detailed below. |
| `isNonDatabaseField`, `plugins/core/lib/querying-writing/knex-field-helpers.js` | Only two assertions in `tests/computed-field-selection.test.js` and one type-only call. `buildFieldSelection` already builds computed/virtual field sets as part of actual selection. | Remove this unused predicate and its isolated assertions/type call. Keep the computed-field selection regressions in the same file. Do not insert a new call just to preserve the helper. |
| `translateSelectFieldsForAdapter`, `plugins/core/lib/storage/storage-adapter.js` | Only two type-only calls in `tests/types/storage-adapter-contracts.js`. Actual selection uses `applyFieldSelectionToQuery` and `createSelectTranslator`. | Remove this unused array/string-alias translation path and its private `translateSourceColumn` helper, which has no other caller. Retain `createSelectTranslator` and the real selection path, including identity and structured-value handling. |
| `getLogicalFieldName`, `plugins/core/lib/storage/storage-mapping.js` | One assertion in `tests/conformance-field-names.test.js`. Real row conversion uses `translateRecordFromStorage`, which performs the reverse lookup directly. | Remove the unused wrapper and its isolated assertion/import. Preserve the `storageInfo.columns` reverse map: row conversion still uses it. Keep the surrounding field-name and mapping regressions. |

### Index analysis is diagnostic, and currently misleading

`createRequiredIndexes` is not called by `analyzeRequiredIndexes` or by resource operations. Deleting it cannot disable automatic index creation on the current query path: that path never creates indexes through this function.

The dormant creator calls `knex.schema.hasIndex`, which is absent from the installed Knex schema implementation and declarations. It also uses a logical field name directly as a physical database column, bypassing ordinary column mappings and canonical field allocation. Errors inside its DDL block are only logged. These are reasons to discard the dormant path rather than connect it to live queries.

`analyzeRequiredIndexes` does have one runtime caller: `crossTableFiltersHook` calls it to emit a debug message. The returned list is not used for query construction, validation or DDL. The analyzer ignores its `scopes` and `log` arguments, scans the entire search schema on each call, and records only the first two dot-separated path components.

That last assumption is already invalid for supported inputs. The shared query fixture defines `actualField: 'groups.teams.name'` in `tests/fixtures/api-configs.js`; the analyzer reports `{ scope: 'groups', field: 'teams' }`, although the terminal searchable field is `teams.name`. It also reports requirements for unused filters and omits polymorphic target-field handling. The live `buildJoinChain` path resolves all path segments and validates the actual terminal field independently.

The smallest sound cleanup is to remove the analyzer and its debug-only caller along with the dormant creator. Retaining meaningful index advice would require a deliberate feature contract covering resolved joins, physical mappings, filter operators and dialects; that work is not justified merely to save this debug message. Keep actual index validation, migration generation and canonical bootstrap unchanged.

## AnyAPI standalone count helper

`helpers.dataQueryCount` in `plugins/core/rest-api-anyapi-knex-plugin.js` has no active runtime caller. Its references are the standalone count tests in `tests/row-policy.test.js` and `tests/anyapi-descriptor-transactions.test.js`, plus the `DataQueryCount` internal declaration and type-only contract exercises. It is attached to `api.helpers`, so it is reachable, but it is not a declared/documented public `resource.count()` operation.

The real collection count is inside `helpers.dataQuery`: it builds the authorized and constrained collection query, clones that filtered query before selection/pagination, and counts distinct canonical resource IDs for offset pagination. Ordinary Knex storage has its own live pagination count path. Public `query()` pagination totals do not call `dataQueryCount`.

The standalone helper instead rebuilds a separate filter pipeline and counts `*`. It does not apply the mandatory `queryConstraint` used by the main path, and joined rows can require distinct-resource counting. Those are concrete implementation differences, not newly reproduced public query bugs: there is no public runtime caller of this helper in the inspected code, and its two existing tests cover simple filters and row policies rather than join fan-out or mandatory selection constraints.

Recommendation: treat this as another redundant internal path, not as an optional public count feature that must be preserved. If removed, move the cold-descriptor/uncommitted-record assertion onto `resource.query()` offset pagination totals and retain policy/count coverage through that same public operation. Delete the helper-only type declaration/exercises and any standalone-only assertion only after preserving the useful behavioral coverage. Keep all actual pagination counts. Do not add a replacement count API solely to justify deleting this helper; an efficient standalone public count can be considered separately if an application needs it.

## Optional plugins are not dead code

The current JSKIT host at `packages/json-rest-api-core/src/server/jsonRestApiHost.js` imports and installs `RestApiPlugin`, `RestApiKnexPlugin`, `RowPolicyPlugin`, `AutoFilterPlugin` and `QueryProjectionsPlugin`. It currently constructs `Api` from `hooked-api`; it has not yet migrated to this checkout's runtime or input contracts. That consumer remains untouched.

Other optional plugin exports should not be classified as leftovers simply because that host does not install them. AnyAPI storage, HTTP connectors, CORS, file handling/custom storage, labels and Socket.IO each provide an implemented capability rather than an unused utility wrapper. Their demand and package placement are product decisions. This bounded audit recommends no removal of those plugins, no removal of the meaningful storage-adapter contract, and no additional abstraction layer.

The separate [consumer feature investigation](consumer-migration-feature-usage.md) traces SQL migration and canonical-storage usage more broadly. Consumer absence alone does not make working migration/schema code redundant.

## Suggested order

1. Finish the confirmed dependency cleanup.
2. Remove the four unused utility exports with only their obsolete assertions/type exercises; keep live field-selection and mapping coverage.
3. Remove misleading index analysis and its debug-only call, preserving actual join validation and explicit index operations.
4. Separately decide whether to remove `dataQueryCount`, migrating its meaningful tests onto public pagination counts first.
5. Leave optional feature removals to explicit product decisions. Run only the affected checks when code changes; this report itself requires no new runtime test run.
