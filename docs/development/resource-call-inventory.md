# Resource call-convention inventory

This is B0-01's current library-surface inventory, checked against runtime
registration, method bodies and published declarations on 2026-09-11. It does
not inventory current downstream call sites; that remains M-02 and the paused
consumer migration. The [API reference](../API.md) and
[migration guide](../GUIDE/MIGRATING_API_V2.md) describe the selected contract.

Resource declaration remains `api.addResource(name, options)` and resource
access remains `api.resources[name]`. Familiar CRUD and relationship method
names remain. No additional ORM object, renamed CRUD layer or argument adapter
is introduced. Methods added by an application's own plugins remain that
application's contracts, not inferred variants of these library methods.

## Resource data operations

Every method below receives a first parameter object and an optional second
application context object. Payload members are explicitly nested. `queryParams`
contains selection/filter/sort/page options, never write attributes. A
transaction is a first-argument control, not a field copied out of context.

`format` selects plain or JSON:API input/output where representations apply.
`returning` applies to POST/PUT/PATCH and bulk POST/PATCH. Resource deletion and
relationship mutations return no record; accepting `format` on linkage methods
does not turn linkage into a plain resource. The option-rejection acceptance
suite separately verifies the seven removed control names.

| Method | Payload / identity | Query options | Other selected controls | Result |
| --- | --- | --- | --- | --- |
| `get` | `id` | `queryParams.fields`, `include` | `format`, `transaction` | One represented resource; missing resource rejects |
| `query` | No write payload | `queryParams.fields`, `include`, `filters`, `sort`, `page` | `format`, `transaction` | Collection envelope with data and pagination metadata/links |
| `post` | `inputRecord`; application-supplied ID belongs inside that record | Response `fields`, `include` under `queryParams` | `format`, `returning`, `transaction` | Full representation, minimal identifier, or no result |
| `put` | `inputRecord` plus target `id`, or ID inside input; supplied IDs must agree | Response `fields`, `include` | `format`, `returning`, `transaction`, optional `expectedVersion` | Selected write result; create/replacement semantics remain explicit |
| `patch` | Same target convention as PUT; only supplied attributes/relationships change | Response `fields`, `include` | Same controls as PUT | Selected write result |
| `delete` | `id` | None | `transaction`, optional `expectedVersion`; `format` is validated | No result |
| `getRelated` | Parent `id`, `relationshipName` | `fields`, `include`; collection relationships also support `filters`, `sort`, `page` | `format`, `transaction` | Related resource/null or collection, according to cardinality |
| `getRelationship` | Parent `id`, `relationshipName` | None | `transaction`; `format` is validated | JSON:API linkage document in either format setting |
| `postRelationship` | Parent `id`, `relationshipName`, identifier array in `relationshipData` | None | `transaction`, optional `expectedVersion`; `format` is validated | Adds to-many membership; no result |
| `patchRelationship` | Parent `id`, `relationshipName`, linkage in `relationshipData` | None | Same relationship-write controls | Replaces membership; to-one accepts identifier/null, to-many accepts array; no result |
| `deleteRelationship` | Parent `id`, `relationshipName`, identifier array in `relationshipData` | None | Same relationship-write controls | Removes to-many membership; no result |
| `bulkPost` | `inputRecords` array; JSON:API mode accepts resource objects or documents per entry | No bulk query-selection parameter | `format`, `returning`, `atomic`, `transaction` | Bulk data according to returning mode, metadata and applicable errors |
| `bulkPatch` | `operations: [{ id, data }]`; JSON:API `data` is a resource object, not a nested document | None | `format`, `returning`, `atomic`, `transaction`, optional aligned `expectedVersions` | Bulk result |
| `bulkDelete` | `ids` array | None | `atomic`, `transaction`, optional aligned `expectedVersions`; `format` is validated | Metadata including deleted IDs and applicable errors |

Runtime owners: `rest-api-plugin.js` registers eleven core data/relationship
methods; `bulk-operations-plugin.js` registers the three bulk methods. Their
published contracts are `types/resource-methods.d.ts`,
`types/relationship-methods.d.ts` and `types/bulk-methods.d.ts`. These are the
fourteen operations covered by response-option acceptance, not an assertion
that every method accepts every option. Unrelated unknown-property rejection
is a separate validation question.

Programmatic defaults are plain/full, overridden by resource configuration and
then applicable per-call controls. HTTP connectors choose JSON:API and full
resource-write responses explicitly; deletes and relationship mutations have
no-content responses. HTTP query parsing and HTTP conditional headers belong
to connectors, not to a second set of core argument conventions.

Data fields named `format`, `returning`, `id` or `queryParams` are interpreted
within the selected record representation, not as the surrounding controls.
PUT/PATCH target IDs retain their documented consistency checks. Retired boolean
options are rejected rather than translated. The migration guide supplies the
old/new map and examples without maintaining a legacy runtime parser.

## Context and transaction boundaries

The second argument carries application identity/authentication and custom
request state. Core methods enrich their operation context; callers grouping
operations should supply separate context objects. Nested permission and
enrichment methods have explicit parent-context parameters, described below;
they do not change the normal CRUD calling convention.

`api.transaction(callback, context?)` is the intentional API-level exception to
the parameter-object convention. Its callback receives the managed Knex handle.
Reads may borrow raw Knex transactions; library writes require managed handles
when participating in an existing transaction. Raw SQL can use that same handle.
Bulk participation must be atomic. Ownership, outcome and dependency limitations
remain in the [transaction guide](../GUIDE/managed-transactions.md), rather than
being hidden behind another argument overload.

## Registered supporting methods

These are included to distinguish extension and schema operations from record
CRUD. They must not be mistaken for missing CRUD overloads.

| Entry point | Input and responsibility |
| --- | --- |
| `resource.checkPermissions` | `{ method, originalContext }`; executes permission hooks, no record result |
| `resource.enrichAttributes` | `{ id, attributes, parentContext, requestedComputedFields, isMainResource }`; returns enriched attributes |
| `resource.applyQueryFilters` | Query state including `query`, `filters`, adapter and query metadata; second argument supplies application context; mutates the supplied builder and completes without a record result |
| `resource.createKnexTable` | Uses declared resource schema; ordinary storage creates its table, canonical storage ensures backing schema and refreshes its descriptor |
| `resource.addKnexFields` | `{ fields }`; canonical storage additionally accepts `searchSchema` and `canonicalFieldsMap`; ordinary DDL and canonical runtime publication have distinct documented effects |
| `resource.alterKnexFields` | Ordinary `{ fields, options }`; canonical storage explicitly rejects this unsupported operation |
| `resource.introspectKnexTableSnapshot` | Ordinary-storage declaration/table inspection; no record payload |
| `resource.generateKnexMigration` | Ordinary-storage migration source from resource declarations |
| `resource.generateKnexMigrationDiff` | Ordinary `{ options }`, compares current table snapshot with declared schema |
| `api.addRoute` | `{ method, path, handler, ...routeOptions }`, registers a transport route |
| `api.release` | Runs release hooks; no record/query payload |

Storage/schema methods are registered by their storage plugin; canonical storage
does not pretend to provide every ordinary DDL method. Imported storage helpers,
file backends, transport setup and Socket.IO events retain their own explicit
contracts. They are not extra resource read/write conventions. The source
registration search found no additional built-in bulk-import resource method.

## Acceptance evidence and remaining scope

The inventory is reconciled with actual `addScopeMethod`/`addApiMethod`
registrations, parameter reads and the public type interfaces. Existing
conformance covers representation/defaults, record/control collisions, target
IDs, relationships, bulk input and context/transaction placement. In particular,
the [response-option acceptance record](verification-progress.md#2026-09-11-response-option-acceptance-audit)
records all fourteen operations and the native matrix. This inventory is not a
substitute for that behavioral evidence or for future final review.

B0-01 can close as a library call-convention inventory. It does not close B0-08
(all local caller migration), Part M's current external-call inventory, public
type implementation coverage, or paired consumer execution. Any discrepancy
found by those audits remains required work.
