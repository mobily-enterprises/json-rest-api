---
title: "Migrating to v2"
chapter: 33
chapter_label: "33"
---

# 33. Migrating to v2

Version 2 changes setup, resource calls and transaction ownership. Upgrade each
application's source and dependency versions together. Old option spellings are
rejected; there is no compatibility mode. This guide describes the required port;
it does not imply that any consuming application or seed generator is migrated.
Before v2 is published, install the intended tarball in place of the registry package.

## Replace the API host

Remove the direct `hooked-api` dependency from the application:

```sh
npm uninstall hooked-api
```

Import the constructor from this package:

```js
import { JsonRestApi, RestApiPlugin, RestApiKnexPlugin } from 'json-rest-api'

const api = new JsonRestApi({ name: 'app', logger: applicationLogger })
await api.use(RestApiPlugin, { format: 'jsonapi' })
await api.use(RestApiKnexPlugin, { knex })
await api.addResource('books', bookOptions)
```

`api.resources.books.get(...)`, the other resource methods and `api.transaction(...)`
keep their documented call shapes. Update the setup and extension code:

| Previous API | Replacement |
| --- | --- |
| `Api` imported from `hooked-api` | `JsonRestApi` imported from `json-rest-api` |
| `api.scopes` | `api.resources` |
| `api.addScope(...)` | `api.addResource(...)` |
| Injected `addScopeMethod` | Injected `addResourceMethod` |
| Setup hook `scope:added` | `resource:added` |
| Resource option `scopeMethods` | Resource option `methods` |
| `customize({ scopeMethods })` | `customize({ methods })` |
| Dependency alternative `'a\|b'` | `dependencies: [['a', 'b']]` |
| Constructor `log` / `logging` options | Injected `logger` object |
| `HookedApiError` base class | `RestApiError` from `json-rest-api` |

Logging is silent by default. Supply the logger's level methods directly; configure
formatting and filtering in that logger. Plugin installation preserves the original
error, so stop matching hooked-api's wrapping message. There is no compatibility mode.
Generic scope aliases, `customize({ apiMethods })` and method-registration lifecycle
hooks have been removed. Install API methods through a plugin's `addApiMethod` instead.

Hooks support named `beforeFunction` or `afterFunction` placement, with one placement
per handler. Numeric ordering and per-plugin placement are unsupported. Returning
`false` stops that hook list; throw an appropriate error to reject a request.

Resources are ordinary objects. Call shared methods with their resource receiver;
use `api.resources.books.get.bind(api.resources.books)` if you need a detached callback.
Resource vars and helpers inherit live API defaults. Local writes override them;
deleting an override reveals the default again. `Object.keys(resource.vars)` lists
local values only, rather than combining inherited defaults.

Await plugin and resource setup sequentially. Discard an instance after a setup failure;
plugin installation is not transactional. Finish setup before serving requests.

TypeScript applications can keep an explicit `JsonRestApi` resource map using the
existing resource, relationship and bulk method interfaces. Ordinary literal
schemas also infer attribute types on the handle returned by `addResource()`;
see [resource and hook typing](../API.md#typescript-resources-and-hooks).

## Remove the S3 demo adapter

`S3Storage` and `S3StorageOptions` have been removed, including the direct
`plugins/storage/s3-storage.js` import. The old adapter generated mock URLs;
it did not upload to S3. There is no replacement export or compatibility mode.

Use the application's existing storage integration through the `FileStorage`
`upload`/`delete` contract, or use `LocalStorage` for local files. Remote-provider
credentials, clients and storage policy belong to the application. See
[file handling](26-file-uploads.md) for the adapter contract.

## Start with the common changes

For an ordinary repository/app migration, work through these first:

1. [Replace the API host](#replace-the-api-host), then [update Node](#runtime-requirement) and [rename the two response options](#rename-the-two-response-options).
2. [Replace `inputRecord` with `data` or `document`](#replace-inputrecord-with-data-or-document) and
   [select input and output independently](#port-calls-that-mixed-jsonapi-input-with-plain-output).
3. [Update configuration and consumers together](#update-configuration-and-consumers-together),
   then check [result shapes](#result-shapes) and [request context](#arguments-and-request-context).
4. Review [relationship writes](#review-relationship-writes) and
   [transaction/error handling](#transactions-and-errors) where your app uses them.
5. [Verify the port](#verify-the-port) against the intended package set.

The remaining sections are feature-specific references. In particular, check
[storage naming](#storage-naming-configuration), [schema migration helpers](#schema-migration-helpers)
and [temporal storage](#temporal-values-and-storage-serializers) before changing
stored data. Connector/plugin sections apply only to the integrations your app uses.

| If your app customizes… | Review |
| --- | --- |
| Stored values or table names | [Structured attributes](#object-and-array-attributes), [temporal values](#temporal-values-and-storage-serializers), [schema helpers](#schema-migration-helpers), [storage naming](#storage-naming-configuration) |
| Queries and output | [Fieldsets](#sparse-fieldsets-include-relationships), [sort fields](#sort-fields-and-defaults), [pagination](#pagination-modes-and-counts), [includes](#full-includes-and-projected-fields) |
| Hooks and plugins | [Read failures](#setter-getter-and-computed-field-failures), [schema enrichment](#schema-enrichment-and-canonical-registration), [write responses](#write-hooks-and-the-returned-response), [query builders](#native-query-builders-and-explicit-custom-filter-translation) |
| Transports and files | [CORS](#cors-and-http-response-hooks), [uploads](#multipart-uploads), [Socket.IO](#socketio-startup-and-shutdown), [bulk writes](#bulk-writes) |
| Logging | [Logger enhancement](#enhancing-an-existing-logger), [error causes](#error-causes-in-diagnostic-output), [field redaction](#field-aware-write-diagnostics) |
| Conditional writes | [Stored revisions](#opt-in-stored-revision-migration), [HTTP conditions](#opt-in-http-representation-conditions) |

## Runtime requirement

Use Node 24 or newer and reinstall dependencies after upgrading Node so native
database modules match its ABI. This library's development and CI checks run on
Node 24 only; `.nvmrc` pins 24.6.0. Update application runtime configuration when
performing its migration.

## Declare searchable relationship fields explicitly

The library no longer guesses that a resource is a pivot table from its number
of belongs-to fields. That heuristic used to enable search automatically, even
overriding `search: false`.

If an application filters a pivot resource by a relationship, declare the filter
on the field or in `searchSchema`, just as for any other resource:

```js
schema: {
  groupId: { type: 'id', belongsTo: 'groups', as: 'group', search: true },
  itemId: { type: 'id', belongsTo: 'items', as: 'item' }
}
```

Here `filters: { group: groupId }` is supported. Filtering by `item` is rejected
unless separately declared. Omitting `search` or setting it to `false` does not
generate a filter; an explicit `searchSchema` entry or schema enrichment hook
can still declare one. Relationship add, replace, remove, related-resource reads
and includes work without enabling public search on pivot fields.

No database migration is needed. Review application calls that directly filter
pivot resources and add only the search declarations those calls require.

## What stays familiar

Keep resource declarations and calls through `api.resources.books`. The familiar
`get`, `query`, `post`, `put`, `patch`, and `delete` operations remain. JSON:API
documents and plain records both remain useful formats. This migration does not
require replacing ordinary repository code with a new ORM.

## Rename the two response options

| Old option | Replacement |
| --- | --- |
| `simplified: true` | `format: 'plain'` |
| `simplified: false` | `format: 'jsonapi'` |
| `returnFullRecord: 'full'` or `true` | `returning: 'full'` |
| `returnFullRecord: 'minimal'` | `returning: 'minimal'` |
| `returnFullRecord: 'no'` or `false` | `returning: 'none'` |

`format` chooses output representation. `returning` chooses how much a write returns.
Boolean aliases and the old option names are removed, not deprecated aliases.

```js
// Before
const book = await api.resources.books.get({
  id: '42',
  simplified: true
})

// After
const book = await api.resources.books.get({
  id: '42',
  format: 'plain'
})
```

For a JSON:API response, use `format: 'jsonapi'`. Keep the existing `queryParams`
container for filters, sort, sparse fields, includes, and pagination unless a
separately documented query-contract change is made.

```js
const document = await api.resources.books.query({
  format: 'jsonapi',
  queryParams: { fields: { books: 'title' }, page: { size: 20 } }
})
```

## Replace inputRecord with data or document

Resource POST/PUT/PATCH accept exactly one input key: `data` for plain resource
values, or `document` for a JSON:API document. The old `inputRecord` parameter is
removed. Both keys together are rejected, including a key set to `undefined`.
Fields inside `data` are resource values; options outside it control the operation.

```js
// Before: plain resource values were inside inputRecord
await api.resources.books.post({
  inputRecord: { title: 'Dune' },
  format: 'plain',
  returning: 'full'
})

// After: plain input remains convenient and has a clear boundary
await api.resources.books.post({
  data: { title: 'Dune' },
  format: 'plain',
  returning: 'full'
})
```

Fields named `format`, `returning`, `queryParams`, `document`, or `data` belong
inside `data`; they are ordinary data there. Plain input is never autodetected as
a JSON:API document. `data.id` is the record identity: on PATCH/PUT it must
match the target `id`, and cannot redirect the operation to another record. Keep the target ID outside the
patch data:

```js
await api.resources.books.patch({
  id: '42',
  data: { title: 'Updated title' },
  format: 'plain',
  returning: 'none'
})
```

When using JSON:API input, rename the parameter to `document` and retain its
document structure. `format` independently selects the response:

```js
await api.resources.books.patch({
  id: '42',
  document: {
    data: {
      type: 'books',
      id: '42',
      attributes: { title: 'Updated title' }
    }
  },
  format: 'jsonapi',
  returning: 'full'
})
```

## Port calls that mixed JSON:API input with plain output

Older versions detected JSON:API documents inside `inputRecord`; the intermediate
v2 contract instead coupled input to `format`. Both are replaced by explicit
input keys. `format` now selects only output, so a JSON:API `document` can return
plain output and plain `data` can return a JSON:API document.

Ordinary repositories can remove JSON:API builders entirely:

```js
// Before: JSON:API input was autodetected under the plain default.
const profile = await profiles.patch({
  inputRecord: createJsonApiInputRecord('userProfiles', { displayName }, { id: userId }),
  transaction: trx
}, requestContext)

// After: record data, target ID, and transaction are explicit.
const profile = await profiles.patch({
  id: userId,
  data: { displayName },
  format: 'plain',
  transaction: trx
}, requestContext)
```

For a belongs-to relationship, plain input uses the relationship name and ID,
for example `data: { name: 'Team', owner: userId }`. Keep existing domain
normalization. A repository intentionally consuming JSON:API documents can keep
its document builder instead:

```js
const profile = await profiles.patch({
  id: userId,
  document: createJsonApiInputRecord('userProfiles', { displayName }, { id: userId }),
  format: 'plain',
  transaction: trx
}, requestContext)
```

There is one resource method implementation, not a separate `api.jsonapi` API.
HTTP connectors submit their request body through `document` and request JSON:API
output. Validation, permissions, hooks and transaction behavior are shared.
Full-response preparation still happens before commit.

Write documents accept optional object-valued top-level `meta`, `links` and
`jsonapi` members. They remain available to hooks on `context.inputRecord` and
are not stored attributes. `errors` and `included` are rejected: accepting
documents does not enable compound writes or JSON:API extensions.

The hook field `context.inputRecord` remains the normalized operation document
for both input kinds. Do not mechanically rename that field when migrating
public call parameters. See the [hook context contract](13-hooks-and-lifecycle.md).

## Update configuration and consumers together

Use the same scalar option names for plugin defaults, resource overrides, and
individual calls. Precedence is **call → resource → plugin → built-in default**.
The built-in defaults are `format: 'plain'` and `returning: 'full'`.

```js
// Before
await api.use(RestApiPlugin, {
  simplifiedApi: true,
  simplifiedTransport: false,
  returnRecordApi: { post: 'full', put: 'full', patch: 'full' }
})

// After
await api.use(RestApiPlugin, { format: 'plain', returning: 'full' })

// A resource can override these defaults.
await api.addResource('books', {
  schema: bookSchema,
  format: 'jsonapi',
  returning: 'minimal'
})
```

Per-method return maps are removed. Choose one resource default and set
`returning` on calls needing a different result. For example, port a former
`{ post: 'full', put: 'none', patch: 'none' }` policy by keeping the full default
and passing `returning: 'none'` on PUT/PATCH. Invalid strings, booleans, maps,
and the removed option names raise `REST_API_VALIDATION`; they never silently
select a fallback.

The library's Express/Fastify resource routes explicitly use `format: 'jsonapi'`
and `returning: 'full'`, regardless of programmatic defaults. Remove
`simplifiedTransport`, `returnRecordTransport`, and simulated `isTransport`
parameters. Standard resource POST responses contain a document with status
201; updates return their document with status 200. DELETE and relationship
mutations return no content. An application owning its HTTP handlers should
select its response contract explicitly.

For jskit-ai, start with `packages/json-rest-api-core/src/server/jsonRestApiHost.js`.
Then update the shared JSON:API CRUD repository and the plain-record repositories
in `users-core` and `workspaces-core`. Update generated-code templates before
regenerating app code. Each app with custom calls or hooks needs its own review.

For applications using the library's Fastify connector, register resources
before starting the server. Connector routes and JSON parsers now occupy their
own Fastify scope, leaving host parsers intact. The route validator uses the
existing request contract without Ajv stripping fields or adding coercion rules.
Both connectors return 422 for invalid resource documents, 400 for malformed
JSON, and 413 for an oversized body. Bodyless resource DELETE works with either
accepted JSON content type.

Check HTTP clients and tests for these boundary changes:

- Send `Content-Type: application/vnd.api+json` without `charset`. Ordinary
  `application/json` requests remain accepted. Unsupported types and JSON:API
  extensions receive 415; unknown profiles are ignored.
- Allow `application/vnd.api+json` in `Accept`, or use an appropriate wildcard.
  Incompatible headers receive 406 before writing. Responses use the exact
  JSON:API media type and preserve `Vary: Accept` alongside other vary values.
- Remove retired options from query strings as well as resource calls. They
  now receive 422. Fractional page sizes/numbers also receive 422 instead of
  being truncated; opaque cursor strings retain their spelling.
- Correct unknown resource types in sparse fieldsets. They now receive the
  typed `REST_API_FIELDSET_INVALID` error (HTTP 400), including prototype-like
  names, rather than being silently ignored.

The [Fastify guide](23-fastify.md) documents body limits, prefixed 404s and
the host's `onBadUrl` setting for malformed URLs. Fastify's default malformed-URL
response occurs before connector hooks and retains its native 400 shape unless
the host configures that setting. Express maps malformed route parameters to
JSON:API errors. These transport changes require no stored-data migration.

## Result shapes

| Operation | `format: 'plain'` | `format: 'jsonapi'` |
| --- | --- | --- |
| `get` | Plain record | `{ data: resource, ... }` |
| `query` | `{ data: [record, ...], meta?, links? }` | JSON:API collection document |
| Resource write, `returning: 'full'` | Plain record | Full resource document |
| Resource write, `returning: 'minimal'` | `{ type, id }` | `{ data: { type, id } }` |
| Resource write, `returning: 'none'` | `undefined` | `undefined` |
| `getRelated`, to one | Plain record or `null` | Document with resource or `data: null` |
| `getRelated`, to many | Same envelope as `query` | JSON:API collection document |

An empty collection has `data: []`. Plain collections retain their envelope so
pagination links and metadata remain available. Plain includes become nested
records; JSON:API includes stay in the document's `included` array with
relationship identifiers in `data.relationships`. Missing primary resources
raise the existing typed `not_found` error.

To-one related reads (`belongsTo`, polymorphic belongs-to, and `hasOne`) now
run the target resource's GET lifecycle whether or not fields or includes are
requested. Previously, a read without those options could bypass target
`checkPermissions`, `checkDataPermissions`, `checkDataPermissionsGet`, and
GET finish hooks by returning an included record directly. Check permission
hooks that previously only ran when callers supplied a fieldset. Target GET
errors now propagate consistently; SQL-hidden or absent linkage still returns
`null`. Parent GET permission checks retain the parent's full attributes.
The caller's transaction is used for both reads and remains caller-owned.

`getRelationship` also retains parent attributes for its internal GET permission
checks, instead of imposing an ID-only parent fieldset. Its response still
contains only linkage and links. A parent data-permission hook that denies a
normal GET can now deny the linkage endpoint using the same attributes.

`getRelated` and `getRelationship` set the current resource's `scopeName` before
permission hooks run. Reusing a context from another resource cannot leave those
hooks checking its stale resource name.

Included resources and relationship identifiers now require the target resource's
`query` permission, including nested includes and default linkage without
`include`. The library applies this check at the shared query-filtering boundary
before loading related rows. A permission hook receives `method: 'query'`, the
target scope/schema, no parent `id` or parent filters, and the caller's auth and
transaction. Explicit permission errors reject the read; row policies continue
to filter individual rows or null hidden to-one linkage. GET-only data hooks
remain part of the single-resource GET lifecycle, not collection/include policy.

Review applications that grant a primary read while denying query permission on
its related resources. Their includes/linkage previously bypassed that denial.
To-one `getRelated` also resolves authorized linkage before running target GET.
A full write response that fails this permission check rolls back its owned
write; `returning: 'minimal'` or `'none'` does not fetch that full response.

Regular-storage many-to-many includes and linkage now enforce the declared pivot
resource's query permission and row filters, before include limits. This applies
to standard and windowed includes with mapped pivot keys. AnyAPI continues to
store these associations as tenant-scoped canonical links rather than rows in a
declared pivot resource; do not expect a pivot-row policy to govern those links.

Canonical many-to-many linkage now applies target query permission and row filters
in SQL before loading link rows. Its `relationship-identifiers` filter query is
built once per relationship read, including an empty relationship, rather than
once per 100 already-loaded target IDs. The returned builder may be used inside
several paged SQL statements. Keep these hooks as query transformations; do not
depend on their call count for per-record work. Parent GETs may still filter
other declared relationships independently. Target auth, transaction and scoped
metadata remain available, and parent filters are not applied to the target.
Public resource arguments and response shapes need no change for this fix.

Plain responses now expand all available included levels. Previously the
converter discarded the remaining included document after the first level and
looked up the wrong nested schema property, losing nested belongs-to identifiers.
For example, `include: ['authors.publisher.country']` now produces
`book.authors[0].publisher.country`. Cycles end with `{ id }` (and `_type` for
polymorphic references), so the result remains JSON-serializable. Repeated sibling
references expand independently; relationships missing from `included` keep their
identifier instead of being dropped. This changes response shape only; stored
records and relationships do not require a data migration.

Plain conversion also shares one type/ID lookup across the included document.
This removes repeated searches for large responses without changing call
arguments or the expansion rules above. It does not impose a new response limit;
large or repeatedly expanded graphs still need memory for their complete output.

For a hasMany related-resource read, the parent relationship no longer needs
`search: true` on the child foreign key or polymorphic discriminator fields.
Parent membership is applied internally alongside your permitted child filters,
before pagination and counts. A caller filter on a searchable parent relationship
is intersected with membership instead of being overwritten. Non-searchable
fields remain unavailable as public filters. Follow the returned pagination
links: they now retain the related-resource route, requested fields, filters,
and pagination parameters.

Many-to-many related reads now use the target resource's collection query too.
Pass target filters, fields, includes, sort and pagination exactly as you would
to `api.resources.books.query(...)`; the library intersects that query with
the parent's membership. Results and counts describe distinct target records,
including when storage contains duplicate links. Default limits and sort now
come from the target resource. Follow returned links to traverse the collection.

Target query permissions and query-filter hooks run on these reads. Regular
storage also checks the declared pivot resource's query permission and filters
its membership subquery. AnyAPI stores membership in tenant-scoped canonical
links. The former per-member GET calls and formatted pivot queries are removed;
move any custom behavior that relied on their GET/finish hooks to the target
query hooks or the appropriate row policy. No scoped consumer source currently
uses `getRelated` or those read hooks.

Resource GET/query and related reads now reject undeclared include paths with
`REST_API_INCLUDE_INVALID` (HTTP 400, `source.parameter: 'include'`), including
empty collections and absent to-one targets. Use declared relationship names,
not attribute names, and remove obsolete paths instead of relying on them being
ignored. Finite cycles remain valid; a polymorphic nested path may apply to a
subset of its declared target types. This follows the
[JSON:API include contract](https://jsonapi.org/format/#fetching-includes).

Two filter corrections can change results: `!= null` selects non-null values,
and `oneOf` with `splitBy` and `matchAll: false` matches any split term as
documented. A `between` filter now requires an array of exactly two non-null
bounds. Use an equality filter for one value; omit an optional range filter
when no bounds are supplied. Empty or oversized arrays no longer silently
remove the range condition. `enablePaginationCounts: false` at plugin level
now disables offset count queries. These changes require no stored-data migration.
Offset totals also count distinct primary resources when a search joins multiple
matching children, so duplicate join rows no longer inflate page counts.

To-one relationship identifiers now obey the target resource's row policy and
autofilters even when you do not request an include. This applies to belongsTo
and polymorphic linkage on primary and included resources, and to full write
responses. A hidden target produces JSON:API `data: null`; plain output omits
that relationship field, following the existing null-belongsTo convention.
Stored foreign keys remain unchanged. Do not use a previously exposed hidden
target ID as an authorization shortcut. A borrowed transaction also governs
these visibility reads. Lookups are grouped by target resource type rather
than performed separately for each record.

AnyAPI now omits belongs-to foreign keys and polymorphic type/ID backing fields
from response attributes, matching regular storage. This also applies to sparse
responses, included resources and plain output. Read the declared relationship:
for example, use `data.relationships.subject.data` in JSON:API or `record.subject`
in plain output instead of `attributes.subject_id` and `attributes.subject_type`.
Hidden targets retain the null/omitted behavior above. Storage columns and write
linkage are unchanged; ordinary ID attributes that do not back a relationship
remain attributes.

Cross-resource and polymorphic search paths now check each joined resource's
`query` permission and apply its row policy/autofilters with
`queryPurpose: 'search-join'`. Move mandatory predicates out of branches that only
handle `collection`. Related-only matches against hidden attributes disappear
from results and counts; a primary attribute can still match an OR search.
Explicit target permission failures reject the query, even if no primary rows
match. No per-target GET hooks run. Combined direct/nested polymorphic filters
now work in either argument order, including mapped tables and columns.

PostgreSQL text searches (`like`, `contains`, `startsWith`, `endsWith`) now work
on numeric relationship IDs by comparing their text representation. A pattern
such as `"01"` does not become the ID `1`, and `"1e0"` does not become `"1"`.
Existing string validation still applies, including trimming. Equality/range
comparisons retain the field's type; text matching retains the database's case
behavior. No call-site or stored-data migration is required for this correction.

The same visibility rule now applies to filters on relationship backing keys:
for example, `filters: { author_id: id }` and the declared `author` alias only
match a visible author. Polymorphic ID/type filters check the declared target
types together; identical IDs in different types remain distinct references.
Hidden and missing references both behave as null, including for `!=`, lists,
ranges and `oneOf` searches. Independent primary-attribute OR matches remain
eligible. These checks use the caller's transaction and run before counts and
pagination. They do not change stored relationships.

Sorting by a relationship key or its declared alias now uses the same visibility
rule. This includes polymorphic ID/type fields and resource `defaultSort`.
Hidden and absent references sort together as null, with later sort fields and
the primary ID breaking ties. Cursor boundaries and generated links use those
same values: a hidden `author_id` appears as `author_id:~null` in a cursor,
never as the hidden author's ID. Visible linkage and includes still work.
The target's `query` permission and `search-join` policy apply to these lookups,
including offset pagination and queries without explicit pagination.
Start a new pagination traversal after upgrading, and follow returned links.

Null and array filters now survive generated pagination links. For manual HTTP
requests, the explicit typed form is:

```text
filter[author][json]=null
filter[authorIds][json]=["1","2"]
filter[authorIds][json]=[]
```

URL-encode these parameters normally. `filter[name]=null` still searches for the
literal string `null`; only the `[json]` suffix requests JSON parsing. Malformed
JSON returns HTTP 400. Generated links use this form for nulls, arrays and object
filter values, preserving embedded commas and empty lists. Programmatic calls
continue to pass JavaScript values in `queryParams.filters`. Use the returned
links directly instead of reconstructing or dropping these typed parameters.

Collection includes now honor the same limits and ordering on both backends.
AnyAPI previously ignored these settings. `strategy: 'window'` limits visible
children per parent, including reverse polymorphic collections; `standard` (the
default) limits the global target set. Under a global many-to-many limit, a shared
target counts once and remains linked to each of its selected parents. Duplicate
links do not consume slots, and selecting query projections no longer switches
away from per-parent limits. `orderBy` uses mapped target fields, relationship
aliases or SQL query projections, with nulls last and target IDs breaking ties.

Review callers that assumed an include returned every related record: the
included relationship linkage now describes its selected subset on AnyAPI too.
Use the related or relationship endpoint for full visible membership and its
pagination. An omitted limit uses the target query default; `limit: 0` selects no
children and `limit: null` explicitly disables the include limit. Window includes
require database window-function support. The resource method signatures are
unchanged by this fix.

The unused deep helpers `buildWindowedIncludeSubquery`, `buildOrderByClause` and
`applyStandardIncludeConfig` were removed from
`plugins/core/lib/querying/knex-window-queries.js`. Configure relationships through
their `include` settings instead of importing storage query builders. No forwarding
exports or compatibility implementation remain. Check application extensions
for imports of the removed helpers.

Other unused deep exports have also been removed: `createRequiredIndexes` and
`analyzeRequiredIndexes` from `knex-cross-table-search.js`, `isNonDatabaseField`
from `knex-field-helpers.js`, `translateSelectFieldsForAdapter` from
`storage-adapter.js`, and `getLogicalFieldName` from `storage-mapping.js`.
Remove imports of these internal utilities. Use resource configuration and the
existing storage adapter when writing custom queries; create indexes through
reviewed schema changes. The automatic cross-table index advice was unused by
query execution and did not reliably identify the required indexes.

The standalone AnyAPI `api.helpers.dataQueryCount` helper has been removed.
Use `resource.query({ queryParams: { page: { number: 1, size: 1 } } })` and read
`result.meta.pagination.total` when a pagination total is needed. This uses the
same filters and access rules as the resource's returned records.

AnyAPI also allocates string slots for non-primary scalar fields declared
`type: 'id'`, including polymorphic backing IDs. Such fields previously lacked
storage. Writes and filters bind the normalized ID as text, avoiding SQLite's
numeric-to-TEXT conversion of `1` to `"1.0"`. Newly supported ID fields are
allocated after the existing ordinary fields so those fields retain their slots
when an unchanged declaration is registered again. If you use an explicit
`canonicalFieldsMap`, assign each such field a free string slot. Back up and
inspect existing descriptors before migration; values never stored by the older
implementation cannot be recovered automatically. This fix does not provide
general schema-reordering or schema-evolution migration.

`returning` governs POST/PUT/PATCH resource writes. DELETE and relationship
mutations return `undefined`. Linkage methods retain one explicit representation:
`getRelationship` returns `{ data, links }`, with resource identifiers, an array,
or null; relationship writes take `relationshipData` in JSON:API identifier
form. Their purpose is to manage linkage, so plain formatting does not flatten
that linkage document.

## Arguments and request context

Keep controls in the first argument and request context in the second. This
convention already matches jskit-ai and avoids moving every context field into
every method's parameter parser. A transaction belongs in the first argument:

```js
await api.resources.books.patch({
  id: bookId,
  data: { title: 'Updated' },
  format: 'plain',
  returning: 'full',
  transaction: trx,
  queryParams: { include: ['author'] }
}, requestContext)
```

Forward both arguments when wrapping resource calls. HTTP relationship routes
now forward the connector context too, and linkage reads forward a caller's
transaction to their nested resource read. No stored-data migration is required
by these option and argument changes.

## Review relationship writes

Reverse relationships (`hasMany`, `hasOne`, and polymorphic `via`) now update the
existing child records through their resource PATCH operation. Previous hasMany
endpoint calls could either fail on raw foreign-key validation or report success
without changing membership. Check for application workarounds that manually
patched children after one of those calls.

For a to-many relationship, POST adds members, PATCH replaces the complete
membership, and DELETE removes only the specified members. Repeated identifiers
and repeated successful add/remove calls do not create extra membership or
delete child records. These semantics follow the
[JSON:API relationship update contract](https://jsonapi.org/format/#crud-updating-to-many-relationships).

```js
const relationship = { id: publisherId, relationshipName: 'books' }
const book = { type: 'books', id: bookId }

await api.resources.publishers.postRelationship({
  ...relationship, relationshipData: [book]
}, requestContext)

// Keep exactly this book; unlink other members.
await api.resources.publishers.patchRelationship({
  ...relationship, relationshipData: [book]
}, requestContext)

await api.resources.publishers.deleteRelationship({
  ...relationship, relationshipData: [book]
}, requestContext)
```

Use `relationshipData: []` to clear a to-many relationship with PATCH. A to-one
PATCH takes one `{ type, id }` identifier or `null`. Unlinking requires the child
foreign key to allow null explicitly (`nullable: true`); an optional field is
not automatically nullable. Target types and cardinality are validated on the
relationship routes as well as normal resource writes.

Normal resource POST/PATCH/PUT payloads can also supply reverse relationships.
PATCH changes only supplied relationships. For PUT, omitting the JSON:API
`relationships` object preserves reverse and many-to-many membership; supplying
that object clears any omitted reverse or many-to-many relationships. Stored
attributes and belongs-to foreign keys still follow PUT's complete replacement
validation. Include every relationship you intend to retain when supplying a
PUT relationships object.

Child PATCH hooks and permissions now run for actual reverse-membership changes,
with the caller context and transaction. A replacement that cannot unlink an
inaccessible existing child fails rather than leaving a partial relationship.
A transaction owned by the operation rolls back earlier changes on failure.
The library leaves completion of a caller-supplied transaction to its owner,
which must now be `api.transaction` for library writes. A rejected participating
write aborts that unit even when caught; a native database error may already have
aborted its SQL transaction. Concurrent replacements now serialize on the parent, and
many-to-many additions lock related records too, including additions through
opposite endpoints. This prevents merged replacements, duplicate pivot rows,
and multiple children left behind by competing hasOne replacements. Belongs-to
and polymorphic writes also lock and recheck their targets after validation;
a target deleted in that interval causes the write to fail.

Reverse additions and replacements now use the same target-identity locking
helper. Equivalent ID spellings under the database's equality rules identify
one child: retaining it does not invoke PATCH again, and adding it through
multiple equivalent spellings writes it once. A removal still ignores missing
or unrelated children. No method arguments change.

Reverse membership reads now use batches of at most 100 requested IDs. A
replacement walks removed children in database ID order, reading at most 101
identifiers at a time and unlinking them before any additions. Keep child hooks
independent of a database's former incidental row order. Hooks and permissions
still run for each changed child, and the enclosing transaction owns rollback;
this does not turn child writes into a bulk SQL update.

Canonical many-to-many attachment also pages existing physical links: at most
100 requested target IDs and 101 returned edge rows per query. Pre-existing
duplicate edges and their payloads remain intact, and inverse metadata is still
repaired on the first retained match. A duplicate-heavy batch can issue more
SQL statements while keeping read memory bounded. Arguments, resource hooks,
target/edge locks and transaction ownership are unchanged; no data migration is
required for this paging change.

Relationship mutations can issue an UPDATE that preserves the parent's ID even
when no attribute changed. That row version change makes stale PostgreSQL
repeatable-read transactions fail instead of applying an old membership snapshot.
Database UPDATE triggers on the parent may therefore run for relationship-only
writes. Resource hooks still follow their existing operation lifecycle; these
internal locks do not invoke a second resource PATCH hook.
If you use per-table database grants, account for parent UPDATEs and target
`SELECT ... FOR UPDATE` statements when configuring the application's database
role.

Treat native deadlock, lock-timeout and serialization errors as failed transaction
attempts. Let `api.transaction` roll back, then retry the complete callback in a
new unit only when its side effects can safely repeat. SQLite permits one active
writer and can reject a stale read snapshot's write upgrade. The library does
not automatically retry or change the caller's isolation level. The core managed
helper owns completion; migrate application transaction wrappers accordingly.

Existing duplicate pivot/link rows are not automatically removed. Inspect any
previously concurrent relationship workloads and reconcile duplicates while
preserving their pivot metadata. For a regular pivot, group by its two mapped
foreign-key columns; for canonical `any_links`, group by `tenant_id`,
`relationship`, `left_resource`, `left_id`, `right_resource` and `right_id`.
Groups with more than one row need reconciliation. This fix requires no column
migration and does not replace database constraints used by direct SQL writers.

Canonical many-to-many removal and replacement now delete the selected links in
scoped SQL batches instead of reading the complete old membership and deleting
each link individually. Both stored directions are recognized, including links
created before an inverse was declared. Retained links keep their row IDs and
payloads; attachment repairs missing inverse metadata in place. Replacement
with `relationshipData: []` also clears matching links whose inverse metadata
is missing. Tenant, relationship and target resource type all constrain the
write, so another resource that reuses a target ID is left intact. No call-site
or schema migration is needed for this batching change. If you instrument SQL,
expect fewer DELETE statements and additional target locks for retained links
during replacement; transaction ownership and the resource hook lifecycle stay
the same.

## Transactions and errors

A failed call can represent a committed write. When commit acknowledgement is
lost, `unknown` does not tell you whether the database stored the change. Keep
an application operation identity and reconcile persisted state before replaying
the write or deleting tracked uploads. No commit/rollback side-effect hooks run
for an unknown outcome. See the [commit uncertainty contract](20-transaction-outcomes.md#when-commit-acknowledgement-is-lost)
for the evidence used and the limits of failure-injection coverage.

Migrate transaction wrappers to `api.transaction(callback, context?)`. Its callback
receives a real Knex transaction for resource calls and raw SQL; the library owns
completion and deferred hooks. Pass that handle through related operations,
using a separate context for each enlisted operation. Remove overlapping
transaction ownership from application wrappers.

Unmanaged raw transactions and child savepoints cannot own library writes.
Raw Knex transactions still support direct SQL, low-level storage helpers and
read-only API operations. See the [managed transaction contract](19-managed-transactions.md).

```js
// Before: a Knex callback owned library writes.
await knex.transaction(transaction => changeBooks(transaction))

// After: the library owns writes, raw SQL and deferred completion hooks.
await api.transaction(async transaction => {
  const book = await api.resources.books.patch({
    id: '42', data: { title: 'Updated title' }, format: 'plain', transaction
  })
  await transaction('audit_entries').insert({ book_id: book.id })
  return book
})
```

Await every operation and let the callback return normally to commit. Throw to
roll back. A caught participating write or observed SQL failure still aborts
the unit. Do not call `commit()` or `rollback()` yourself inside the callback.
Pass the received handle through helper functions to compose work; calling
`api.transaction` again starts a separate top-level unit.

Completion ownership is private to the library. Remove any hook code that sets
`context.shouldCommit` to take over or suppress completion; that diagnostic flag
does not control it. Each operation's completion hooks receive its own context.
Every accepted resource/relationship operation runs its completion chain once,
including nested PATCH calls made by relationship replacement and reverse-child
updates. Update observers that assumed one completion hook meant one database
commit. Transaction and bulk owners do not add a synthetic resource hook chain.
On rollback, failed operations retain their original error, while successful
operations receive the owner's failure. Inspect secondary completion errors on
the outer helper's context.

Reusing a context after a successful write no longer carries the previous
commit flag into a later operation. A rejected write rolls back its own new
transaction, while an operation borrowing a caller's transaction leaves its
completion to the caller. This also fixes connection exhaustion after denied
entries in non-atomic bulk calls that reuse authenticated context.
PUT validation also uses the current payload and record rather than attributes
retained from a previous call. Omitting populated attributes still fails a
replacement; creating a new ID does not inherit the old record's requirements.

Write failures now use the root export `RestApiWriteError`. Read failures retain
their existing contract. The wrapper's `cause` is the original thrown value and
its read-only `transactionOutcome` is `none`, `pending`, `committed`, `rolledBack`
or `unknown`. Existing `code`, `subtype` and other ordinary diagnostic fields
remain readable directly. Code that compares original error identity or checks
the original class with `instanceof` must inspect the cause instead.

```js
import { RestApiWriteError } from 'json-rest-api'

try {
  await api.resources.books.post({ document, format: 'jsonapi' })
} catch (error) {
  if (!(error instanceof RestApiWriteError)) throw error
  console.error(error.code, error.transactionOutcome, error.cause)
  throw error
}
```

A nested write can be another `RestApiWriteError` in the cause chain. For example,
an atomic batch preserves its child's `pending` snapshot while reporting the
outer transaction as `rolledBack`. HTTP JSON:API errors add
`meta.transactionOutcome`; non-atomic bulk errors add
`error.transactionOutcome` per entry. Status codes alone do not establish whether
a write committed. A `committed` or `unknown` failure must not trigger blind
replay, and `pending` leaves the decision to the transaction owner. Even confirmed
database rollback says nothing about external effects already performed.

For example, a POST using a generated ID can commit a new book, then reject
because an `afterCommit` notification fails. Repeating that POST creates another
book. The first error reports `committed`; it is a failed call with a stored
write. A lost commit acknowledgement instead reports `unknown`, which also
cannot authorize a blind retry. Handle the failed side effect or reconcile the
write using application identifiers rather than replaying it automatically.

Errors before transaction setup—including malformed bodies, oversized requests
and explicit request rejection—report `none`. A response-hook failure after a
successful write reports `committed`; adding that failure does not erase an
earlier write's confirmed outcome. Read-only HTTP errors have no write-outcome
metadata.

Owned transaction completion now also checks Knex's `executionPromise`. Knex can
resolve `commit()` or `rollback()` while reporting a failed control query through
that promise. Such failures now reject the write or become rollback diagnostics;
they no longer run the corresponding completion hooks or publish committed
registry metadata. Existing payloads and stored data need no migration. A rejected
commit still does not prove rollback, including when the driver reports itself
completed. The [outcome contract](20-transaction-outcomes.md) explains
the evidence and remaining verification boundaries.

PostgreSQL can also acknowledge COMMIT by reporting ROLLBACK after an earlier
SQL error was caught. Those writes now reject instead of reporting success.
The library recognizes the confirmed rollback, runs existing resource rollback
cleanup, and avoids commit hooks or cache publication. It does not issue a
second rollback. This correction requires no payload or stored-data migration;
an application hook that catches a database error can now expose a failure
that was previously mistaken for a successful write.

Custom transaction factories must return top-level transactions. Returning a
savepoint previously allowed `afterCommit` or registry cache publication before
the parent transaction committed. Owned completion now rejects that case and
rolls back the savepoint; it leaves unrelated parent work and parent completion
with the caller. The failure reports rolledBack only when savepoint rollback
is confirmed. Managed acquisition now rejects that factory result before
resource hooks or uploads run. Explicit raw savepoints passed in `transaction`
also reject before library writes; their raw SQL and completion remain the
caller's responsibility. No schema or stored-data migration is needed.

Resource and relationship write failures now retain the original error when
rollback, an `afterRollback` hook, or error logging also fails. The supplied
operation context exposes the original `error` and `cleanupErrors`, an ordered array of
`{ phase, error }` entries. Phases include `rollback`, `afterRollback` and `logging`.
File cleanup adds the phases and field information described under multipart
uploads; diagnostics gathered before rollback are retained.
Managed completion records rejected hook chains with `operationIndex`,
`scopeName` and `method`, using `afterCommit` or `afterRollback`. Internal
diagnostic-collection failures use `finalization` and `finalizerIndex`.
Later completion work is still attempted after an earlier failure. On confirmed
commit the first completion failure is primary; on rollback the original write
or callback failure remains primary. See the
[managed completion contract](19-managed-transactions.md#completion-work).
These diagnostic fields are cleared at the start of the next write, including
when its context is reused. The original error object is not mutated; frozen
errors retain their identity as the wrapper's cause. A failure rejected before
transaction setup has outcome `none` and its own original `context.error`.

`afterRollback` receives the original failure as `context.error` and runs only
after rollback is confirmed, including PostgreSQL reporting ROLLBACK for COMMIT.
If rollback rejects without confirmation, the library retains
that secondary failure and does not claim rollback succeeded or run rollback
cleanup hooks. A participating write leaves completion to its managed owner. Asynchronous
error logging is awaited, and its rejection is recorded without replacing the
write error. These fields are diagnostics separate from the wrapper's immutable
transaction outcome. Atomic bulk rollback uses the same diagnostic shape, as described above.
Remaining cleanup and extension-error boundaries are still under review; the
rollback-hook and logging guarantees above describe resource and relationship
methods.

The shared failure handler also checks the driver's completion state before
attempting rollback. A commit wrapper that rejects after actual completion
cannot trigger rollback hooks that delete committed uploads. Completion alone
does not prove which outcome occurred; without confirmation the error reports
`unknown`.

Query-projection and include errors retain their original causes, including
`null`, `undefined` and other non-Error throws. Typed API errors propagate
unchanged through reads and become the write wrapper's cause when raised during
a write. Unexpected projection errors have a wrapper with resource/field
context and `cause`. Include errors retain their context through the cause
chain. Redundant logging in nested include catches has been removed so it cannot
replace the failure. GET/query reject an affected response; full write-response
failures occur before owned commit, and borrowed transactions remain active for
their owner. Callers should classify typed errors and inspect causes rather
than match the wording of unexpected-error messages. Field callbacks follow
the policy below; arbitrary hook-dispatch failures remain under review.

Direct canonical registry reads and explicit descriptor refreshes retain unexpected causes with
`context: { tenant, scopeName, phase: 'descriptor' }`. Typed API errors keep
their identity. The direct registry lookup returns null for absent persisted
metadata; a required refresh rejects without replacing the published resource.

Canonical resource operations use published descriptors, so a cold or failing
registry read no longer blocks an otherwise valid CRUD/relationship request.
Required published metadata that is missing still rejects, as do invalid stored
relationship targets and data-query failures. Data reads/writes continue using
the active transaction. Borrowed transactions remain active for their owner to
complete. CRUD arguments and response shapes are unchanged; direct registry
changes take effect only through the publication steps above.

POST, PUT and PATCH also reject an unexpected failure while refreshing
`context.minimalRecord` after writing. Previously this failure could be logged
and ignored, allowing a successful response and completion hooks with stale
state. The cause chain retains the failure and resource context with phase
`postWriteRead`; typed errors retain their identity within that chain. This refresh runs for
`returning: 'full'`, `'minimal'` and `'none'`. It happens before finish hooks and
owned commit, so a failure rolls back owned changes, including relationship
updates. Borrowed transactions remain active for the caller to complete.

Callers need no new option. Handle the rejected operation and correct the
metadata/storage failure instead of relying on partial success. Custom
`dataGetMinimal` helpers must propagate read failures; they cannot rely on the
library ignoring them. Express and Fastify send an error response for failures
in request data reads and writes (500 for unexpected failures, the original
status for typed errors). Configuration-read failures outside a request do not
invalidate an already published resource. These rules do not change post-commit
outcome uncertainty.

## Verify the port

1. Confirm the library resolves to the intended v2 artifact, and each app resolves
   to the matching versions of its shared repositories and generated code.
2. Run library checks and affected application tests; an old installed
   dependency passing tests does not verify the port.
3. Exercise a create/read/update/delete flow, scoped authorization, and a complete
   pagination traversal in each relevant app. Check a multi-operation rollback
   wherever transaction ownership changes.
4. Regenerate affected source and confirm it emits the new calls directly.
5. Recheck call sites added during the migration, and remove obsolete wrappers
   and imports once their replacements pass.

Record the verification commands and artifact versions with each application
upgrade. Apply these steps to seed generators and generated templates as well
as checked-in application code.

## TypeScript imports

The package exposes declarations through `json-rest-api` itself:

```ts
import { RestApiPlugin, RestApiWriteError } from 'json-rest-api'
import type { RestApiPluginOptions, ResourceCoreMethods, ResourceVersionOptions } from 'json-rest-api'

const restOptions = {
  format: 'plain',
  returning: 'minimal'
} satisfies RestApiPluginOptions

// The resource schema must also declare revision as a stored string attribute.
const versionOptions = { versionField: 'revision' } satisfies ResourceVersionOptions

interface Book { title: string }
async function readTitle(books: ResourceCoreMethods<Book>, id: string) {
  const book = await books.get({ id })
  return book.title // string | undefined: sparse fields can omit title
}
```

Use normal value imports for plugins, storage classes and errors; use type-only
imports for option and resource interfaces. No runtime files live under the
declaration `types/` directory. TypeScript consumers need Node and Knex types for
the current declaration surface. Framework peers are still optional at runtime.

For ordinary literal schemas, retain the handle returned by `addResource()` to
infer attribute names and value types. `ResourceSchema`, `InferInput` and
`InferOutput` also support reusable definitions. Existing JavaScript setup and
call syntax stay the same. The library's `npm run test:public-types` checks these
declarations through a packed consumer.

An explicit `JsonRestApi` resource map remains the choice for typed central
registries, relationships, dynamic enrichment, method replacements and custom
API-level defaults. Match its format/returning generics to the actual resource
configuration. Plugin installation itself does not infer options or methods;
use `satisfies` with the plugin's option interface. Literal resource registration
checks built-in field and resource options. Custom plugin configuration uses an
explicit intersection with its own interface. See the
[typing contract and limits](../API.md#typescript-resources-and-hooks).

Known hooks now describe phase-specific input and library-owned fields. This
does not change mutable context at runtime. If a hook receives an ownership type
error, inspect the documented mutation phase rather than casting it away.
Use `HookHandler<Event, AppContext>` for known hooks and
`RuntimeHook<PluginContext>` for arbitrary plugin events; see the
[hook guide](13-hooks-and-lifecycle.md).

## Object and array attributes

Declare structured fields using their public JSON type:

```js
schema: {
  metadata: { type: 'object', nullable: true },
  tags: { type: 'array', nullable: true }
}
```

Built-in storage writes JSON text and reads it back as objects or arrays, in
both plain and JSON:API responses. Nested JSON values, empty objects/arrays and
SQL null are preserved. Canonical storage now accepts arrays in its existing
JSON slots; adding this support does not alter existing tables.

Remove setters whose only purpose was `JSON.stringify`. A setter for an object
or array must return that logical type; it can still prepare or transform its
contents. Reads now return structured values, so remove application-level
`JSON.parse` calls that expected these fields to be strings.

```js
// Before: storage conversion was done in a setter.
metadata: { type: 'object', setter: value => JSON.stringify(value) }

// After: built-in storage owns JSON conversion.
metadata: { type: 'object' }
```

If a custom storage representation is necessary, keep its conversion in
`storage.serialize` and decode it with a getter. The getter receives the driver's
stored value: native JSON columns may return an object, while text columns
return a string. For example:

```js
metadata: {
  type: 'object',
  nullable: true,
  storage: {
    serialize: value => value == null ? null : JSON.stringify({ wrapped: value })
  },
  getter: value => value == null
    ? null
    : (typeof value === 'string' ? JSON.parse(value) : value).wrapped
}
```

Getters decode custom representations before the final declared shape check.
Built-in structured values are decoded before getters on dependent fields and
computed callbacks run. A stored value with the wrong declared shape fails the
read. Built-in writes reject wrong-shaped setter results, circular references
and BigInt values before SQL, including with `returning: 'none'`. Supply JSON
compatible contents; the default serializer uses JavaScript `JSON.stringify`.

### Querying structured attributes

Whole-object/array equality and ordering are not generic library operations.
Remove `search: true`, generic search aliases/`oneOf` references, explicit
`sortableFields`, and default sorts targeting those fields. A structured
projection cannot declare `sortable: true`. Local invalid declarations reject
schema compilation; relationship paths reject when resolved, allowing forward
resource declarations. A request to sort a structured field returns a validation
error (HTTP 422) before SQL. Direct adapter comparison conversion also rejects
structured fields, including null and empty arrays, before invoking serializers.
Array operands for `in` and `between` on scalar stored fields remain supported.

Expose the JSON key that gives the application a meaningful order as a scalar
projection. For example, this selects an integer `metadata.value`:

```js
queryFields: {
  metadataValue: {
    type: 'integer',
    sortable: true,
    select: ({ knex, column }) => {
      const field = column('metadata')
      if (knex.client.config.client === 'pg') {
        return knex.raw('CAST(CAST(?? AS json) #>> ?::text[] AS integer)', [field, '{value}'])
      }
      if (knex.client.config.client === 'mysql2') {
        return knex.raw('CAST(JSON_UNQUOTE(JSON_EXTRACT(??, ?)) AS SIGNED)', [field, '$.value'])
      }
      return knex.raw('CAST(json_extract(??, ?) AS INTEGER)', [field, '$.value'])
    }
  }
}
```

Then use `queryParams: { sort: ['metadataValue'], page: { size: 20 } }`.
Scalar projections support sparse output and forward/backward cursor traversal.
Sorting and cursor comparisons operate on the selected SQL value; output getters
format that value afterwards. Custom storage serializers must produce values
compatible with the physical column, and custom scalar cursors must satisfy the
declared scalar type. A getter does not make an incompatible stored cursor valid.

For application-specific JSON filters, use `searchSchema.applyFilter` with an
explicit SQL predicate and bound values. This callback owns the predicate's
meaning and value encoding. For example, a null-presence filter for built-in JSON
storage can resolve the physical column without hard-coding canonical slots:

```js
searchSchema: {
  hasMetadata: {
    type: 'boolean',
    applyFilter: (query, present) => {
      const column = api.knex.helpers.getStorageAdapter('books').translateColumn('metadata')
      return present ? query.whereNotNull(column) : query.whereNull(column)
    }
  }
}
```

The example belongs to the `books` resource. Use the query hook's adapter and
alias when a custom filter introduces joins. Whole-document custom comparisons
must account for the chosen database's JSON semantics.

PostgreSQL JSON selections now use `to_jsonb` so relationship filters can remove
duplicate parents with `DISTINCT`. This applies to stored structured fields and
structured projections. Public object/array values are preserved, and existing
tables are not altered. Custom structured storage should use JSON-compatible SQL
representations, such as JSON columns or JSON-encoded text.

## Temporal values and storage serializers

Use JSON values in both plain and JSON:API write records:

| Field type | Input example | Public read value |
| --- | --- | --- |
| `date` | `'2024-02-29'` | `'2024-02-29'` |
| `dateTime` | `'2024-03-01T07:59:59.987+08:00'` | `'2024-02-29T23:59:59.987Z'` |
| `time` | `'09:30'` or `'09:30:00.123'` | `'09:30:00'` or `'09:30:00.123'` without a declared precision |
| `epochMilliseconds` | `1709251199987` or `'1709251199987'` | `1709251199987` |
| `epochSeconds` | `1709251199` or `'1709251199'` | `1709251199` |

Client date/dateTime fields take strings, not JavaScript Date objects or SQL
datetime text. Use `null` to clear a nullable field. Epochs must be integers:
zero and negative epochs are valid; the absolute limits are 8640000000000000
milliseconds and 8640000000000 seconds. Calendar dates must exist. DateTime
offsets must normalize to a UTC year between 0000 and 9999; values outside that
range now fail validation before built-in storage, including writes requesting no record.

`temporalPrecision` limits fractional digits. Built-in dateTime conversion uses
JavaScript Date and supports milliseconds. It rejects nonzero submillisecond
digits; declaring precision 6 alone does not enable six-digit writes. A value
ending in `.123000Z` can be stored as `.123Z`. Database strings can retain finer
precision when read. Time fields remain strings and do not require a Date
conversion. Getters, computed fields and response hooks may return native Date
or BigInt values; the declared temporal field type normalizes the final response
and rejects invalid values.

Keep `storage.serialize(value, details)` functions on stored attributes.
Both storage modes honor them for writes and filters.
The function receives the logical `fieldName`, actual `columnName`, `definition`,
`schemaInfo`, write `context`, and `operation` (`post`, `put`, `patch` or `filter`).
Comparisons use `operation: 'filter'` and a null context. Return the same storage
representation for equivalent values on writes and comparisons. The callback
must be synchronous; returning a Promise now fails before the SQL operation,
including when no write response is requested. Use field setters for asynchronous preparation. Custom temporal
serializers must preserve the required precision, normalize offsets consistently,
and return values supported by the chosen SQL column/driver and read normalizer.

### Temporal formatting and native databases

Time reads now always include seconds. With `temporalPrecision: 3`, both
`'09:30'` and `'09:30:00.000'` read as `'09:30:00.000'` and compare equally.
Without a declared precision, redundant fractional zeros are removed:
`'09:30:00.100000'` reads as `'09:30:00.1'`. Update assertions that depended on
the submitted spelling. DateTime reads use UTC, retain meaningful microseconds,
and keep at least millisecond digits unless a smaller precision is declared;
`.100000Z` reads as `.100Z`, while `.123456Z` remains unchanged.

Library reads request temporal strings from PostgreSQL/MySQL so driver Date
conversion cannot discard microseconds or shift calendar dates. These options
apply to library queries; the supplied Knex instance's connection configuration
and ordinary caller queries are unchanged. PostgreSQL uses its normal ISO date
output. Built-in PostgreSQL writes/comparisons bind explicit UTC values and map
public year 0000 to PostgreSQL's 1 BC. MySQL native DATE/DATETIME writes reject
years below 1000 with `storage_range`, following its documented supported range.
Use a custom text column/serializer if the application needs earlier MySQL dates.
See [node-postgres temporal parsing](https://node-postgres.com/features/types)
and [MySQL date ranges](https://dev.mysql.com/doc/refman/8.0/en/datetime.html).

New table creation and generated migrations use fractional precision 6 for
dateTime/time columns when no precision is declared. An explicit precision
still takes precedence. This avoids MySQL's default precision 0 rounding a
timestamp into the next second or day. Existing regular tables need an ordinary
schema migration to the intended precision; table creation does not alter them.
Preserve each column's nullability, defaults and other modifiers in that migration.
The regular-table diff now detects temporal precision changes. PostgreSQL time
columns created through older Knex helpers may report precision 6 even when the
resource declared precision 3: the previous time builder ignored that argument.
New table creation and migration code declare `time(n)` explicitly. Inspect live
precision before changing existing columns; reducing it can round stored values.

Native `setValues` columns require an explicit MySQL target when generating a
migration, for example `{ dialect: 'mysql2' }`. Runtime create/add/alter helpers
reject SET columns on other clients before SQL. A cross-dialect migration diff
continues to warn and omit unsupported SET changes; review those warnings rather
than treating the generated supported subset as a complete schema migration.

Schema helpers now reject invalid `temporalPrecision` before executing SQL.
Native PostgreSQL/MySQL time/dateTime columns require an integer from 0 through 6.
For finer precision, use a text column and an appropriate storage mapping. When
intentionally generating a higher-precision SQLite definition, pass an explicit
`dialect: 'better-sqlite3'`; an unspecified migration target is rejected for
precision above 6. Migration diffs use their explicit or introspected dialect.
Runtime create/add/alter helpers use the actual database client, regardless of a
supplied migration-dialect option. SQLite column declarations remain distinct
from the built-in dateTime converter's millisecond write limit.

Increasing precision cannot restore digits already discarded by older writes.
Native PostgreSQL/MySQL TIME columns reject input with more than six meaningful
fractional digits before writing; SQLite and AnyAPI text time slots can retain
finer values. [MySQL fractional-second behavior](https://dev.mysql.com/doc/refman/8.0/en/fractional-seconds.html)
also explains why directly injecting extra digits into a lower-precision column
can round them before the library reads them.

For custom PostgreSQL serializers, include an offset on timestamp-with-time-zone
values, such as `'2024-02-29T23:59:59.123456Z'`. Offset-free timestamp input uses
the server session's time zone. A custom serializer must make that choice
explicit and use the same representation for comparisons.

Query projections compare the SQL expression's stored value directly, retaining
microsecond precision without a write serializer. Remove `storage` from
`queryFields` declarations; it is now rejected during compilation. Keep the
serializer on the underlying stored attribute.

### Custom serializer cursors and projection getters

Cursors for serialized attributes and SQL projections now retain the database
value before getters run. Following a cursor binds that value directly instead
of serializing it again. For example, a serializer that stores `"alpha"` as
`"stored:alpha"` previously produced a next-page comparison against
`"stored:stored:alpha"`. Numeric scaling had the same problem.

Restart pagination after upgrading and use returned cursors or links unchanged.
Do not build a cursor from response attributes: getters can change the value,
and database temporal spelling can differ from the JSON representation. Scalar
cursor validation still checks the declared type; temporal validation accepts
the supported database spelling without changing the bound value. Sort order
is the SQL value's order. A getter does not change that order.

Projection declarations no longer take `storage`, `setter`, or `runSetterAfter`.
For example, this precise timestamp projection needs no serializer:

```javascript
queryFields: {
  preciseTimestamp: {
    type: 'dateTime',
    temporalPrecision: 6,
    sortable: true,
    select: ({ knex, column }) => knex.raw('??', [column('recordedAt')])
  }
}
```

Projection `getter` and `runGetterAfter` declarations now execute through the
same compiled dependency order as stored-field getters. They were previously
ignored. Getters may be async; computed fields receive their completed values.
Remove a previously ignored getter if its behavior was not intended. Invalid
callbacks/dependencies reject compilation, and getter failures propagate as
read errors before computed output runs.

Resource ID fields and relationship backing ID/type fields cannot declare
`storage.serialize`, including declarations added by enrichment or canonical
field additions. The previous behavior could change an ordinary foreign key
while canonical storage bypassed the write callback and only serialized filters.
Remove these serializers; use resource `normalizeId` for ID canonicalization.
Already transformed stored IDs require an explicit application data migration;
removing a callback does not repair existing data automatically.

### Existing AnyAPI temporal data

New AnyAPI resources allocate `date` and `time` fields to string slots. Calendar
dates and times of day do not need a timestamp column. `dateTime` fields retain
the `date_N` slots, now with fractional precision 6. Existing metadata assigning
date/time fields to timestamp slots, or native canonical timestamp columns with
lower precision, causes an explicit migration-required error.
Resource re-registration checks the persisted mapping before replacing it, so
starting the new API cannot silently rebind unmigrated temporal fields to empty
slots. Complete the data migration before registering those resources again.

For disposable development data, recreate the AnyAPI database and run the seeds
against the new schema. For data that must be preserved:

1. Back up the database and stop application writers for the migration.
2. Inventory date/time fields from `any_resource_configs.schema_json` and their
   mappings in `any_field_configs`. Reserve unused `string_N` slots per resource;
   the existing limit is ten string slots. Update any explicit
   `canonicalFieldsMap` declarations to those allocations.
3. Copy each old field into its reserved string slot on `any_records`, selecting
   only that metadata row's tenant and resource. Use `YYYY-MM-DD` for dates and
   the time format above for time-only values. Inspect the raw stored values
   and the original write time zone: an old API read may already have shifted a
   date or discarded precision. Keep the old slots until verification is complete.
4. Update that field's `slot_type` to `string`, `slot_index` to the reserved
   index, and `slot_column` to its `string_N` name. Keep logical IDs, tenant/resource
   identifiers and relationship rows unchanged. Do not recreate metadata for
   unrelated fields or renumber their slots.
5. On PostgreSQL/MySQL, migrate `any_records.date_1` through `date_5` to timestamp/
   datetime precision 6, preserving the PostgreSQL time-zone type and column
   modifiers. Even an unused canonical timestamp slot must have precision 6.
6. Restart the library to reload descriptors. Verify row counts, date/time
   values, nulls, relationships, exact filters and complete cursor traversals
   against the backup before resuming writers.

The repository includes an executable example at
`examples/migrations/anyapi-temporal-v2.js`. Its named
`migrateAnyApiTemporalFields(transaction, moves)` function implements steps 3–4
in batches of 100 records. It requires an explicit source/target mapping and a
conversion callback for each field. It checks the persisted field type and source
mapping, rejects occupied targets (including unassigned slots containing data),
validates converted strings against the declared temporal precision, and leaves
old slots and unrelated metadata intact. Nulls are copied without invoking the
callback. Soft-deleted records are included.

For example, **only if the original application stored dates at UTC midnight
and times as UTC-anchored timestamps or bare time strings**, the conversion can be:

```js
import { migrateAnyApiTemporalFields } from 'json-rest-api/examples/migrations/anyapi-temporal-v2.js'
import { normalizeDateValue } from 'json-rest-api/plugins/core/lib/querying-writing/database-value-normalizers.js'

const moves = [
  {
    tenant: 'your-tenant', resource: 'events', field: 'day',
    from: 'date_1', to: 'string_8',
    convert: value => normalizeDateValue(value, 'date')
  },
  {
    tenant: 'your-tenant', resource: 'events', field: 'atTime',
    from: 'date_2', to: 'string_10',
    convert: value => typeof value === 'string' && /^\d{2}:/.test(value)
      ? value
      : normalizeDateValue(value, 'dateTime').slice(11, -1)
  }
]
const report = await knex.transaction(trx => migrateAnyApiTemporalFields(trx, moves))
```

Replace every name and slot with the inventory from your database. Converters
receive the raw value and `{ tenant, resource, field, id }`, may be asynchronous,
and must return a valid string for every non-null value. PostgreSQL/MySQL reads
retain raw temporal strings so the driver cannot discard microseconds before
conversion. Use a different converter for a local calendar/time convention or
custom serializer; the example does not infer the original time zone. Update
any serializer that still expects the old timestamp representation.

Let a conversion error escape the transaction callback so Knex rolls back all
copied records and mapping changes. The example neither commits nor rolls back
the caller's transaction. Rerunning completed moves fails the source-mapping
check; inspect metadata instead of treating that error as success.

For step 5, the following is the tested precision change for **standard,
nullable canonical columns with no defaults and Knex's default timezone type**:

```js
// PostgreSQL/MySQL only; run separately from the data transaction.
await knex.schema.alterTable('any_records', table => {
  for (let index = 1; index <= 5; index++) {
    table.dateTime(`date_${index}`, { precision: 6 }).nullable().alter()
  }
})
```

Inspect column definitions first and adapt this DDL if their type, nullability,
default or other modifiers differ. MySQL DDL can commit implicitly; the copy
transaction and this precision change are separate operations. Keep writers
stopped if either fails. Increasing precision preserves existing values but
cannot recover fractional digits lost in earlier writes.

In the restarted resource declarations, preserve **all** existing allocations in
`canonicalFieldsMap`, changing only the migrated fields. A supplied map must
include every stored non-ID field. For the test resource, the complete map is:

```js
canonicalFieldsMap: {
  name: 'string_1', day: 'string_8', atTime: 'string_10',
  occurredAt: 'date_3', personId: 'rel_1_id'
}
```

`tests/anyapi-temporal-migration.test.js` executes this example and the standard
precision DDL on SQLite, PostgreSQL and MySQL, with fresh API initialization,
overlapping logical IDs in two tenants, relationships, nulls, exact filters,
forward/backward cursors, failed conversions and caller rollback. These are
isolated synthetic migrations. Verify the conversion against a copy of each
application database and update its seed generators before deployment.

AnyAPI's duplicate private filter pass and its unused deep helper exports
`coerceValueForDefinition`, `normalizeFilterValues` and `ensureFilterableField`
were removed. Declare filters in the resource/search schema and use ordinary
resource queries. Remove direct imports of these private helpers if your
application has any.

## Schema migration helpers

`generateKnexMigrationDiff()` now preserves undeclared indexes and foreign keys
by default, as it already did for columns. A resource declaration need not
describe every constraint in an application's database. Check `warnings` for
preserved metadata. For an intentional removal, pass the corresponding boolean
in `options`: `allowDropColumns`, `allowDropIndexes` or `allowDropForeignKeys`.
These options reject non-boolean values. Explicit changes to a named index or
foreign key can still produce a replacement, with a warning.

Column drops reject when their plan retains a dependent index or foreign key.
Full snapshots also reject generated columns and SQLite partial/expression
indexes, instead of reporting an incomplete comparison of those features.
Use an authored migration for database features outside the snapshot model.
Review warnings about required-column backfills and narrowing integer ranges.
Generation does not execute DDL; keep migration execution/history in the app's
Knex workflow and write recovery steps deliberately. See
[diff migrations](21-schema-and-migrations.md#diff-migrations).

Regular `addKnexFields` and `alterKnexFields` now honor resource-level
`storage.naming`. Under `naming: 'exact'`, `loginCount` addresses that exact
column. Inspect tables previously changed through these helpers for unintended
snake-case columns; this fix does not rename or move existing data. Retain
explicit `storage.column` mappings in supplied field definitions.

AnyAPI `addKnexFields({ fields, canonicalFieldsMap?, searchSchema? })` now persists
added definitions and refreshes the compiled schema, including defaults,
transforms and cached request contracts. A multi-field call uses one metadata
transaction. Existing records remain unchanged; backfill old rows separately.
Missing `fields`, duplicate fields and invalid maps now throw instead of silently
succeeding or leaving unusable metadata. See
[AnyAPI field additions](21-schema-and-migrations.md#anyapi-field-additions).

Explicit maps take effect during registration, before `createKnexTable()`.
Repeating that method no longer re-registers the initial schema and discards
additions. Keep the expanded declaration and complete map in app source for
restart, including functions that JSON metadata cannot reconstruct.

Deep `AnyapiRegistry` writes must receive a transaction from `api.transaction`
when joining an existing unit. `addKnexFields()` uses this owner for its metadata
batch internally. Direct registry callers must invalidate the registry descriptor
cache after confirmed commit. Transaction-local reads use that
transaction and bypass the global cache, preventing rolled-back metadata from
leaking through cached descriptors. This does not publish new resource metadata.
Resource operations use `resource.vars.schemaInfo.descriptor`, the same published
mapping as their storage adapter. CRUD, counts, includes and relationship calls
do not query configuration tables or apply direct registry changes implicitly.
Register related resources on the API before querying them; persisted registry
entries alone do not supply runtime resource declarations.

Use `addKnexFields()` for supported field additions; it commits metadata before
publishing the new compiled schema and adapter. After a direct, committed mapping
migration with the same declarations, invalidate the registry cache and call
`createKnexTable()` to refresh the descriptor. A failed refresh retains the
previous published resource. Structural schema changes also need updated source
declarations and compilation; invalidation alone cannot reconstruct callbacks.
Perform configuration/mapping changes while application operations are stopped.
Arbitrary in-place metadata edits or concurrent reconfiguration are not a
supported publication mechanism. No automatic data migration is performed.

The internal `preloadRelatedDescriptors` helper now accepts
`{ descriptor, scopes }` and returns its map synchronously; `scopes` is the
resource collection. It no longer accepts registry/transaction arguments.
`AnyapiQueryAdapter` no longer stores its unused registry argument. Deep callers
must use the published resource metadata when building related query maps.

Owned registry registration/allocation now preserves the original failure when
rollback also rejects; secondary diagnostics go to the registry error logger.
Failed owned writes invalidate cached descriptors, including when a commit
call rejects after database completion. A completed transaction is not rolled
back again, and its next descriptor read reloads persisted metadata. Rejection
does not by itself establish that a write was rolled back or can safely be
retried. The descriptor cache also isolates tenant/resource pairs containing
`::`; this cache-key change does not alter persisted data or method arguments.

The registry now retains at most 100 recently used descriptors. This is a cache
bound, not a resource limit: an evicted descriptor reloads on the next explicit
registry lookup, while normal resource operations continue using their published
metadata. Direct registry callers must pass `{ transaction }` when borrowing
one; do not rely on a warm cache to avoid acquiring another database connection.
An explicit `{ bypassCache: true }` read that confirms removal now discards its
stale cache entry. It does not remove a running resource or publish a new schema.
No data migration or resource declaration change is needed for cache eviction.

Request-contract reuse now includes the resource name in its key. Deep callers
sharing compiled field definitions across resource names receive the correct
JSON:API type validation. Temporal normalization still accepts its supported
precision declarations; unusual precision simply builds an uncached validator.
Neither correction adds a caller option or requires a payload migration.

Schema inspection now supports PostgreSQL's current schema. Generated migrations
preserve BigInt defaults as BigInt literals, and unchanged effective defaults or
implicit size metadata no longer cause repeated alterations. Diff plans now
include `dropCheckConstraints` for PostgreSQL inline-enum replacements. Generated
enum diffs execute on PostgreSQL/MySQL; SQLite diffs report a required table rebuild
and retain the existing enum definition. This is distinct from changing only an
enum default, which is supported on all three databases. See the
[schema and migration guide](21-schema-and-migrations.md) for execution
and transaction limits. These helpers do not automatically migrate existing
application databases.

Direct `alterKnexFields` now replaces PostgreSQL inline enum checks correctly,
with rollback on failure. SQLite changes that require replacing an enum check
throw before the field batch starts; changing only its default still works.
For deep-helper callers, PostgreSQL transactions retain ownership through a
savepoint. MySQL caller transactions are rejected before their implicit DDL
commit, and SQLite borrowed rebuilds require foreign-key enforcement disabled
before the transaction starts, with validation/restoration owned by the caller.

Schema DDL now preserves apostrophes, backslashes and question marks in enum
values and static text/JSON/array defaults. Inspect previously generated or
applied definitions containing those characters; regenerate faulty migration
code and migrate stored data explicitly where necessary. Standalone generators
must specify `options.dialect` for values needing dialect-specific SQL escaping.
Resource generators infer the dialect from their Knex client.

MySQL diffs replacing a foreign-key-supporting index now include the dependent
key in `dropForeignKeys` and `addForeignKeys`, even if its definition is unchanged.
Review the whole plan and pause application writes for these multiple-statement
DDL migrations; MySQL does not roll them back as one transaction.

## Sparse fieldsets include relationships

Fieldsets now restrict attributes **and relationships** in both formats. Earlier
versions rejected valid relationship names yet returned unrequested relationships.
Update requests that use both `include` and `fields` to select the relationships
their callers read:

```js
// Before: relied on an unrequested author relationship being returned.
queryParams: { include: ['author'], fields: { books: 'title' } }

// After: asks for both the attribute and the relationship.
queryParams: {
  include: ['author'],
  fields: { books: 'title,author', authors: 'name' }
}
```

Use the declared relationship name (`author`), not its storage field (`author_id`).
An empty fieldset (`books: ''`) returns no attributes or relationships; omit
`books` from `fields` for the normal visible response. IDs remain present.
Included resource types obey their own fieldsets, and unrequested computed
fields are not evaluated. Full write responses follow the same rules without
changing the fields stored by the write.

JSON:API still permits requested `included` resources when the primary fieldset
omits their relationship linkage. Plain output reaches related resources through
selected relationship properties, so select each relationship along a nested
path. No stored-data migration is required. See the
[JSON:API sparse-fieldset rules](https://jsonapi.org/format/#fetching-sparse-fieldsets).

The internal `findRelationshipDefinition` helper moved from
`rest-api-plugin-methods/common.js` to
`lib/querying-writing/relationship-contracts.js` under `plugins/core`, so fieldset
validation and relationship methods use the same resolver. Update any deep
imports; the former module does not forward that export.

## Generated labels and computed visibility

`LabelPlugin` now preserves an explicitly declared stored or computed `label`.
Automatic labels use public stored values, resolve a global-search alias through
its local `actualField`, retain null fallbacks in sparse reads, and fall back to
the current resource's logical ID. Hidden, normally hidden and virtual fields
are excluded as automatic sources. Applications that need a custom display rule
can declare their own computed `label`; see the [label guide](18-labels.md).

Computed callbacks now receive `{ id, attributes, ... }`, with the record's public
logical ID supplied on GET, query and included-resource reads. Existing callbacks
can keep their current arguments. Use `id` instead of looking for a custom ID
column in `attributes` or using the parent request's ID.

Declare a computed field's inputs in `dependencies`, especially normally hidden
stored fields. Sparse reads no longer fetch every normally hidden field just
because one computed field was requested. That fallback could select nonexistent
virtual columns and made sparse/full behavior disagree. Declared virtual inputs
are not selected as SQL columns.

Hidden computed fields are no longer returned. Normally hidden computed fields
require an explicit sparse-fieldset request. Visibility also applies after
virtual input values are added to a full write response. Review callers that
accidentally relied on these values being exposed.

Automatic labels require no data migration. If an older LabelPlugin installation
removed an authored stored `label` from the compiled schema, check whether its
column/canonical mapping exists and use the normal schema migration helpers to
add it if needed. Values that were never persisted cannot be recovered by this
code change.

## Cursor validation and registered schema handlers

Cursor validation now uses the type handlers and validators captured by the
resource's compiled attribute schema. Previously each cursor field created a
schema from the current global registry, so changing a registered handler could
make cursor validation disagree with the already-compiled resource.

Register schema extensions before adding resources. Existing compiled resources
retain those handler functions; a new resource initialization or supported
recompilation captures the current registrations. This does not introduce general
live schema editing. Normal cursor spelling, numeric conversion, opaque IDs,
null ordering, temporal precision and HTTP validation errors are unchanged.
Temporal output conversion keeps its existing separate contracts and precision
behavior; cursor validation does not truncate an invalid over-precise token.

Applications using resource methods need no argument changes. Direct importers
of the internal `validateCursorValues` helper must pass the owning schema as its
fourth argument:

```js
validateCursorValues(descriptors, values, 'after', scope.vars.schemaInfo.schemaInstance)
```

The helper has no fallback to the global registry. Contract reuse is scoped to
that schema instance, and values/errors remain local to each call.

## Field dependencies and projection metadata

Getter/setter declarations keep their callback signatures and use
`runGetterAfter`/`runSetterAfter`. Computed fields keep `dependencies` and
`compute({ attributes, id, ... })`. Dependencies now support transitive chains
and fields without their own callback. Missing names, cycles, non-array
declarations and supplied non-function getters/setters fail registration.
Remove placeholder `null`/`false` callbacks; omit the callback and its ordering
property when the field needs no transformation.

List every local input a callback reads. Sparse reads fetch the entire dependency
chain, run getters before computations, and compute prerequisites once. A getter
cannot depend on a computed field; move that calculation to a computed field.
Setters see available validated input and earlier setter results; they do not
load omitted PATCH fields from the database. Read logical IDs from callback
`id`. Remove read dependencies on raw relationship backing fields or relationship
aliases: these are not attribute values at callback time. The
[dependency contract](12-field-transformations.md#dependency-contract)
includes a chained example and visibility rules.

Full write responses now apply virtual getters before computations. Virtual
input belongs to the written type/ID and is no longer copied onto included or
unrelated records. Update calculations that expected raw virtual input after a
getter, and remove any reliance on a parent's input appearing on its includes.

For custom plugins, replace writes to `scope.vars.queryFields` in `resource:added`
with declarations in `context.queryFields` during `schema:enrich`. Read the final
map from `scope.vars.schemaInfo.queryFields`. There is no compatibility copy at
the former path. Core normalizes the declarations and checks collisions against
the final attribute/computed/relationship/ID namespace before publication.
Canonical additions rebuild this map together with dependencies.
See the [plugin example](29-writing-plugins.md#the-query-field-seam).
Ordinary applications using `QueryProjectionsPlugin` and resource `queryFields`
options keep that setup unchanged.

The unused internal `sortFieldsByDependencies` wrapper was removed. Internal
code uses the existing `topologicalSort` through `compileFieldDependencies`;
applications should declare dependencies in their resource schemas.

### Response dependency metadata

JSON:API resource objects no longer expose the internal
`__$jsonrestapi_computed_deps$__` member. Update snapshots or application code
that consumed it. Computed fields still receive their dependencies during
enrichment; cleanup happens at the final response boundary, including full and
minimal write responses after finish hooks.

Use declared `dependencies` and callback arguments for computations. Put
application metadata in `meta` or declared attributes. Cleanup removes only the
reserved resource-level member; keys inside user attributes and metadata retain
their values. Method arguments and stored records need no migration for this fix.

## Resource IDs and links

Write documents and relationship identifiers accept strings or finite numbers,
then apply the resource's ID normalizer and schema. Plain inputs now preserve
those values for the same validation as JSON:API inputs. They no longer silently
drop zero, turn false into an unlinked relationship, or stringify objects into
IDs. Use `null` to clear a to-one relationship. Convert a BigInt to a string
before placing it in a write document or relationship identifier.

The default normalizer trims strings and accepts numeric path IDs (including
BigInt); it no longer accepts booleans, arrays or objects through implicit
`toString()`. A configured `normalizeId` remains the explicit customization
point. Resource-specific normalizers still override the plugin default.

PATCH and PUT use the path ID only when the body ID is absent or undefined.
An explicit zero must match the path after normalization. Explicit null, empty
or invalid body IDs fail validation instead of being replaced by the path ID.
For example, this now rejects without changing record `42`:

```js
await api.resources.books.patch({
  id: '42',
  format: 'plain',
  data: { id: 0, title: 'Wrong target' }
})
```

The schema still controls valid keys: `type: 'id'` requires positive values;
an integer or string key can permit zero. Public IDs remain strings. Leading
zeroes, case, punctuation and large numeric strings remain intact for opaque
string keys. Use a string to avoid JavaScript numeric precision loss.

SQL bigint primary and relationship IDs now retain their exact decimal values
on library reads and writes. For example, `9223372036854775806` and
`9223372036854775807` remain distinct through includes, relationship changes
and cursor pages. For explicitly supplied keys this large, use a string ID
declaration and pass decimal strings; keep SQL primary and reference column
types compatible. Existing text keys retain leading zeroes.

Storage hooks can now receive an exact string where SQLite or MySQL previously
returned a rounded Number. Keep identifiers as strings instead of converting
them with `Number()` or `parseInt()`. This correction needs no new API option or
data migration. It applies to library queries without changing the caller's
Knex connection configuration. A Number already rounded in application code
cannot be repaired by the library.

PostgreSQL seed/import jobs that write explicit IDs into sequence-backed keys
must synchronize the sequence before later generated-ID inserts. Explicit IDs
do not advance that sequence. Keep synchronization in the seed/import workflow.
Both ordinary and custom ID columns are exercised with actual
PostgreSQL/MySQL generated inserts and all return modes.

Resource and relationship URLs, including POST's Location header, now encode
the ID as one path segment. Pass the original ID to resource methods; follow
returned URLs as supplied, without encoding them again. For example, ID
`part/one?x` produces `/books/part%2Fone%3Fx`.

Table creation and migration generation now map `type: 'integer'` to integer
columns; previously it fell through to string columns. Existing tables are not
altered automatically. If you used these helpers with integer declarations,
inspect the stored values and review the generated migration before applying
it. Determine whether existing application tables need conversion before
applying the changed schema helpers.

## Storage naming configuration

Use a string for `storage.naming`: `snake_case` (also `snake` or `snakeCase`) or
`exact` (also `field` or `verbatim`). Omit it for `snake_case`. Coercible objects
and inherited property names such as `constructor` are invalid naming modes
and now reject at the normalization boundary. Replace an object with its
intended string value; applications using the documented strings need no change.

Canonical row conversion also preserves a field literally named `undefined`
when a relationship lacks a reverse attribute mapping. An absent mapping no
longer causes that unrelated attribute to be removed.

### Public field names and physical columns

Declared fields named `constructor`, `prototype`, `toString`, `valueOf`,
`hasOwnProperty`, `isPrototypeOf`, `propertyIsEnumerable` and `toLocaleString`
are handled as own fields. Stored values, generated filters, sparse responses,
cursor sorting and field callbacks must not resolve to inherited JavaScript
properties. This applies to plain records and JSON:API attributes.

Ordinary Knex storage rejects physical columns literally named `constructor`,
`prototype` or `__proto__`. Knex's update compiler drops these names; a write
could previously leave an old value unchanged. Validation now rejects these
mappings during resource registration, adapter creation and table/migration
generation. Unsupported `idProperty` names are also rejected. Use an explicit
physical mapping while keeping the public name:

```js
schema: {
  constructor: {
    type: 'string',
    storage: { column: 'constructor_value' }
  }
}
```

If the old physical column already contains data, first rename it in your normal
database migration, then change the declaration. For example:

```js
await knex.schema.alterTable('books', table => {
  table.renameColumn('constructor', 'constructor_value')
})
```

Review dependent indexes, constraints and raw SQL, and verify row counts and
values on the application's database before enabling the new declaration.
Registration and `createKnexTable()` do not rename existing columns for you.
Canonical storage uses allocated slots and does not need this physical-column
mapping for public `constructor` or `prototype` fields.

Minimal reads used by write authorization and PUT completeness checks now
translate physical columns to logical fields once. If a physical column name
also names another logical field, hooks now receive the correct original
attributes. Update any hook that compensated for the previous double mapping.

### Declaration dictionaries and reserved names

Use plain objects or null-prototype dictionaries with **own** declarations for
schemas, search fields, projections and relationships. Definitions inherited
from a custom prototype now reject instead of disappearing during compilation.
This includes an object literal such as `{ __proto__: definition }`, which
changes an object's prototype rather than declaring an ordinary property.

`__proto__` is not a supported field, filter, projection, relationship alias or
relationship backing-field name. These declarations reject before compilation
can lose the key. The same checks apply after enrichment hooks, during field
additions, in direct storage/table helpers and at the canonical registry's write
and descriptor-loading boundaries. Rename such a declaration. Preserve the
existing physical column or canonical slot through an explicit mapping when it
contains data; do not re-register over old metadata to erase migration evidence.

These checks do not recursively strip user data. An object-valued attribute can
contain JSON keys named `__proto__`, `constructor` or `prototype`; strings such
as `__proto__` also remain valid resource IDs. Their existing validation rules
still apply.

Declare a belongs-to relationship alias as a string, for example
`ownerId: { type: 'id', belongsTo: 'users', as: 'owner' }`. Numbers, booleans,
arrays and objects in `as` now reject during schema validation, including values
introduced by `schema:enrich`. Replace `as: ['owner']` with `as: 'owner'`; do not
depend on JavaScript coercing a configuration value into a property name.

The relationship mapping options `target`, `through` and `via` also require
strings when supplied. For example, change `target: ['users']` to
`target: 'users'`, and `through: ['memberships']` to `through: 'memberships'`.
They check the declaration's type; they do not require a forward-referenced
target or pivot resource to be registered earlier.

Use strings for schema `belongsTo` targets and relationship `foreignKey` and
`otherKey` names too. In particular, enrichment hooks cannot bypass the
backing-name type checks: change `foreignKey: ['ownerId']` to
`foreignKey: 'ownerId'`. A schema field uses `belongsTo: 'users'`, not
`belongsTo: ['users']`.

Polymorphic relationship declarations require `types` to be a nonempty array of
nonempty strings, and `typeField` and `idField` must be nonempty strings.
For example, use `{ types: ['users'], typeField: 'subjectType', idField:
'subjectId' }` as the `belongsToPolymorphic` definition. The authored
polymorphic registration check still requires its target resources to be
registered; these shape checks do not establish backing-column existence.

For reverse relationships, `hasOne` requires `target` and `foreignKey`; `hasMany`
requires `target` and either `foreignKey` or its reverse-polymorphic `via`;
`manyToMany` requires `through`, `foreignKey` and `otherKey`.
Many-to-many `target` remains optional where the
existing relationship-name default applies.

Declare these relationships in the resource's `relationships` option.
`computedSchema:enrich.schemaRelationships` remains an inspection input, as
described in [computed enrichment](#computed-field-enrichment). Defensive
validation now catches malformed relationship mappings if a hook mutates that
input; this does not make mutation or replacement of the inspection map a
supported relationship declaration API. Move such declarations into the
resource configuration when migrating.

Resource **names** must be JavaScript
identifiers starting with a letter, `_` or `$`, excluding `__proto__`,
`constructor` and `prototype`. Other inherited names such as `toString`,
`valueOf` and `hasOwnProperty` now work with omitted or explicit fieldsets.
This resource-name restriction does not prohibit `constructor` or `prototype`
as attribute or relationship names. Valid relationship aliases also work in
include trees and polymorphic include grouping.

Null relationship representation is unchanged: JSON:API contains `data: null`;
plain conversion omits that relationship property. Use `Object.hasOwn(record,
name)` when checking for presence of a potentially inherited name.

This establishes the own-property and reserved-name boundary. Full JSON:API
member-name validation and other namespace/capability conflicts remain part of
the wider compiled-metadata work; arbitrary punctuation is not guaranteed to
work in every query syntax.

## Sort fields and defaults

Use a string or an array of strings for resource `defaultSort`:

```javascript
// Replace this inconsistent configuration:
defaultSort: { field: 'name', direction: 'desc' }

// With:
defaultSort: ['-name']
```

The object form previously passed registration but failed through the public
query method. Invalid non-string entries now fail during schema compilation.
`null` and `[]` leave the default as ascending resource ID; explicit query sorting
overrides the resource default. Keep programmatic `queryParams.sort` as an array.
The resource ID remains the stable tie-breaker unless already included.

Sorting by `id` always means the resource ID. Sorting by a stored attribute or
query projection uses that field, even if `searchSchema` defines a filter with
the same name and a different `actualField`. For example:

```javascript
searchSchema: {
  name: { type: 'string', actualField: 'shortName' },
  byShortName: { type: 'string', actualField: 'shortName' }
},
sortableFields: ['id', 'name', 'byShortName']
```

Here `filters: { name: 'Ada' }` still filters `shortName`; `sort: ['name']`
orders the stored `name`. Use `sort: ['byShortName']` to order by the distinct
alias. An explicit sortable alias must resolve to a scalar stored field;
relationship aliases retain their visibility checks. Whole-document JSON and
cross-resource scalar ordering are not introduced by this change.

The same resolution applies to collection include `orderBy`. Cursor comparisons
use the stored field's type and selected value, independently of the filter's
input type. Sort fields needed internally are selected even when sparse output
omits them. Ordinary and canonical storage both follow these rules.
Restart existing cursor traversals after upgrading if a filter alias overlapped
a sort field; the old cursor may describe a different ordering.

### Hidden sort fields

Fields marked `hidden: true` cannot be sort keys. This includes stored fields,
their search/relationship aliases, query projections, resource `defaultSort`,
explicit `sortableFields`, and collection include `orderBy`. Previously, an
explicit hidden stored sort could produce an incomplete cursor; a hidden
projection marked sortable could expose its SQL value in cursors and links.

Remove hidden fields and their aliases from sort configuration and choose a
public scalar sort field instead:

```javascript
schema: {
  secret: { type: 'string', hidden: true },
  displayOrder: { type: 'integer', normallyHidden: true }
},
sortableFields: ['id', 'displayOrder'],
defaultSort: ['displayOrder']
```

Use `normallyHidden` only for publicly readable values that should be omitted
by default. They remain sortable and their values can appear in cursors even
when omitted by a sparse fieldset. Keep sensitive values `hidden`.

Invalid local declarations fail during schema compilation with
`REST_API_VALIDATION` and violation rule `hidden_sort`. Include ordering is
checked when the target resource is resolved, preserving forward declarations.
Request validation excludes hidden sort keys, and query hooks cannot reintroduce
them. Hidden fields/projections still work as declared getter/computed
dependencies; their raw values remain omitted from resource output.

## Pagination modes and counts

SQLite ordering now uses native `NULLS FIRST/LAST`, preserving the public null
placement and cursor results while allowing existing ordering indexes to help.
The verified engine is SQLite 3.49.2; SQLite engines older than 3.30 are no longer
supported by these ordering helpers. PostgreSQL/MySQL ordering is unchanged.
No payload or cursor migration is needed. Optional index choices and the existing
migration paths belong in reviewed [schema migrations](21-schema-and-migrations.md).

The existing page options keep their meanings in both storage modes:

| Query page | Behavior |
| --- | --- |
| Omitted or `{}` | Apply the resource's capped default limit; omit pagination metadata |
| `{ number: 2, size: 25 }` | Offset page 2, using the capped size for the offset and links |
| `{ number: 2 }` | Offset page 2 with the resource's default size |
| `{ size: 25 }` | First cursor page |
| `{ after: cursor }` or `{ before: cursor }` | Adjacent forward/backward cursor page with the resource's default size |

Add `size` to a cursor boundary to choose a different page size. Page sizes are
capped by `queryMaxLimit`. Use one of `number`, `after` or `before`; combining
them, supplying non-positive/fractional page numbers/sizes, or supplying an
empty cursor rejects before SQL. Follow generated links to retain filters,
fieldsets and the effective size.

`enablePaginationCounts` controls totals for offset pages. With counts disabled,
offset metadata contains `page` and `pageSize`; it does not promise totals or
`hasMore`. Cursor pages use one extra row for `hasMore` and never issue a count
query, regardless of this setting. Ordinary storage previously issued a count
on the first cursor page and discarded its result; that extra query and its
count-filter hook invocation have been removed. Collection predicates still
run for every cursor page. Keep mandatory filters in the collection path.

Malformed cursor syntax now has the same error message in either storage mode,
with code `REST_API_VALIDATION`, a `page.after` or `page.before` field, and rule
`invalid_cursor`. Prefer the typed code/details when handling errors instead of
matching a former backend-specific message. No call-site migration is needed
for applications already using the page options above.

## CORS and HTTP response hooks

Install `CorsPlugin` after Express or Fastify. Installation without a connector
now fails immediately. Pass options directly to `api.use(CorsPlugin, options)`.
Origin predicates may be async: their boolean result is now awaited, including
inside origin arrays. A rejected predicate becomes a 500 response without CORS
permission. Do not rely on the old behavior that treated a Promise as permission.
`origin: false` disables origin permission, and `maxAge: 0` disables preflight
caching. These values are no longer replaced by defaults.

Denied OPTIONS responses now use the JSON:API error envelope (`errors[0]`,
status 403) instead of `{ error: 'CORS origin not allowed' }`. Other requests
retain their actual resource/status behavior; CORS does not authorize writes.
Existing credential/origin defaults remain permissive, so use explicit allowed
origins for credentialed applications. See the [CORS guide](24-cors.md).

`transport:response` now runs for early parser/media/Accept errors and explicit
`context.reject(...)` responses. Its request body can therefore be undefined;
avoid assuming authentication, parsing or a resource method has completed.
The hook chain is attempted once. If it throws, the connector maps the error
without rerunning response hooks. A response-stage failure cannot roll back an
already committed write.

Vary headers from the host, custom route, CORS and response hooks are merged
case-insensitively, including on rejected requests; compare fields rather than
their order. Fastify's native malformed-URL boundary still precedes connector
hooks and has no connector CORS headers. Raw responses sent by host middleware
or a hook that takes over the response need their own headers. No stored-data
migration is required.

## Multipart uploads

Unexpected file detector/parser/storage errors now retain their cause and
operation context. Typed errors still propagate unchanged. Unexpected storage
failures return HTTP 500 rather than being mislabeled as validation errors;
declared MIME/size/schema violations remain 422 and typed access denials remain
403. Update callers that classified every upload failure as invalid input.

File cleanup keeps attempting later files after a cleanup or warning-log failure.
Inspect `context.cleanupErrors` for `temporaryFileCleanup`, `uploadedFileCleanup`
and associated `logging` entries. Failed deletions retain their tracking entries
for reconciliation. Tracking belongs to the creating transaction, preventing a
reused context from deleting files committed by an earlier transaction. Managed
rollback invokes enlisted cleanup hooks after confirmed completion.

After commit, uploaded objects belong to the application. Replacing or deleting
a record does not delete its previously committed files, including when no
references remain in that resource. URLs may be shared across records and
external consumers. If your application needs garbage collection, establish
ownership and absence of references before calling `storage.delete(url)`; do
not attach unconditional file deletion to a record's DELETE or replacement.
Rollback cleans only newly uploaded objects belonging to the failed transaction.
See the [file ownership contract](26-file-uploads.md#ownership-after-commit).

`LocalStorage` now reserves filenames exclusively, so concurrent original/custom
names cannot overwrite another upload or make rollback delete its bytes.
Existing files and symlinks are occupied names. Filename inspection now rejects
permission and other I/O failures instead of returning an available name.
Failed uploads remove only their reserved destination. If removal or closing
also fails, inspect the returned `AggregateError`'s `cause` and `errors` for the
original and cleanup failures. Its destination may need reconciliation. Buffer
and temporary-file inputs retain their existing signatures; see
[storage behavior](26-file-uploads.md#storage-adapters).

Install `FileHandlingPlugin` before `ExpressPlugin` and install the selected
optional peer (`busboy` or `formidable`). Missing parsers and invalid factories
now fail setup. The Express connector accepts multipart only when a detector is
registered and uploads are enabled; Fastify continues to reject multipart.

The corrected parsers use Busboy 1.x and Formidable 3.x. Both return buffered
files with `filename`, `mimetype`, `size` and `data`. If a custom storage adapter
used Formidable's old `file.filepath` or `file.cleanup`, use `file.data` instead:
the detector now removes its private request directory before returning.
Custom detectors' cleanup callbacks are still supported.

Repeated file fields now produce 400. Upload one file for each distinct declared
file field. Repeated text fields become arrays consistently across parsers;
bracketed array suffixes group values in arrival order. Unknown text/file fields
are validated, including prototype-like names that could previously disappear.
Parser limits produce 413, and declared file MIME/size violations produce 422.
Review the documented [bounded defaults](26-file-uploads.md#protocol-configuration)
and set parser limits explicitly when larger uploads are needed.

Multipart POST/PUT/PATCH use the route's resource type; PUT takes its ID from
the URL. Required file fields follow the normal schema rules, so PATCH can omit
an existing file. Numeric `maxSize` now works, including zero for empty files.
Plain programmatic calls with custom detectors update the canonical input record
correctly. Detector errors propagate instead of falling through to another
parser or silently continuing the write.

Owned and managed rollback cleanup, multiple uploads, replacement and deletion
are verified with real local storage. Previously committed files remain
application-owned: replacing a URL or deleting its resource does not delete
the old object, which may have other references. Confirmed rollback cleans new
uploads; confirmed commit releases their tracking. Review
[file ownership after commit](26-file-uploads.md#ownership-after-commit)
when migrating application cleanup code. No stored-data migration is required
by this parser correction.

## Socket.IO startup and shutdown

Keep the existing `await api.startSocketServer(server, options)` call, and await
it before accepting subscription traffic. Calling it while another start is
pending or a Socket.IO server is active now rejects; remove duplicate bootstrap
calls instead of relying on replacement of a live server.

Redis connection failure no longer leaves Socket.IO attached or published in
`api.io`. Partial connections are closed, the HTTP server and authentication
configuration remain intact, and the application can retry. The supplied Redis
reconnection policy still controls retries. Set
`redis.socket.reconnectStrategy: false` if your bootstrap should reject on the
first connection failure.

Closing Socket.IO also closes the HTTP server supplied to it. The plugin now
owns shutdown of its two Redis clients when that HTTP server closes and clears
`api.io` and its server/client references. Remove any subsequent manual `quit()`
calls on `api.vars.socketIORedisClients`. Close your application database
separately. No new shutdown method, compatibility wrapper or data migration is
required. The [Socket.IO guide](28-socketio.md) lists the verified paths and
the remaining network/failover limits.

## Socket.IO subscriptions and notifications

Subscription messages now accept only `resource`, `filters` and an optional
nonempty string `subscriptionId`. Remove `include` and `fields` from subscribe
and restore messages; those options never changed the notification data. Keep
them in the subsequent resource GET/query instead. They are also absent from
the acknowledgement's `data`. Other unknown options receive `UNSUPPORTED_OPTION`.

Null, scalar and array filters now receive `INVALID_FILTERS`. A duplicate active
subscription ID receives `SUBSCRIPTION_EXISTS`; unsubscribe before replacing it.
Concurrent admissions respect the per-socket limit. A subscription hook receives
`{ context }`, with `context.subscription` and `context.auth`; it may modify
filters but not identity. Its final filters are validated.

Custom SQL search fields use their existing `applyFilter(query, value)` callback
for subscription matching too. Remove Socket.IO-only `filterRecord` callbacks;
the earlier draft's requirement for a parallel JavaScript predicate is withdrawn.
Notification eligibility now runs ordinary resource queries before/after writes
in the same transaction, with subscriber identity and an internal changed-ID
constraint. Query hooks must support these calls.

If row policies or autofilters need context beyond `auth`, supply it from trusted
server data in the existing hook:

```js
subscriptionFilters: {
  functionName: 'subscriber-context',
  handler: ({ context: { subscription, auth } }) => {
    subscription.context = {
      scopeValues: { workspaceId: auth.workspaceId },
      visibility: { groups: auth.groups }
    }
  }
}
```

The property defaults to `{}`. Keep it JSON-serializable when using Redis.
Client messages cannot set it. Populate whatever context your own policies
require; the property names above are application examples. Resource query
permissions receive this context on admission and notification as well.

Relationship POST/DELETE now run `beforeDataCall` and their respective
`beforeDataCallPostRelationship` / `beforeDataCallDeleteRelationship` hooks
before mutation. Hooks shared across methods must handle these operations.

Update consumers of `change.type`:

| Previous value | New value |
| --- | --- |
| `resource.postd` | `resource.created` |
| `resource.putd` | `resource.created` for PUT-create, otherwise `resource.updated` |
| `resource.patchd` | `resource.updated` |
| `resource.deleted` | Unchanged |

The `action` field retains resource method names (`post`, `put`, `patch`,
`delete`). IDs, including `deletedRecord.id`, are strings. Relationship changes
produce parent updates with action `patch`, and changed reverse children also
produce their resource updates. Each matching subscription gets its own event;
use `subscriptionId` when one connection holds multiple views. Both entering and
leaving a filtered or authorized result trigger invalidation when the corresponding
query succeeds. Deletion uses the before-write query.

Query permissions are checked again before notification. `socket.data.subscriptions`
is now a serializable array for adapter transport; applications that inspected
the old internal Map must update that code. No stored-data migration is needed.
The [Socket.IO guide](28-socketio.md) separates verified local behavior from
remaining Redis failover/network uncertainty. Atomic bulk enlists each child's
completion hooks with its owner. A failed deferred notice now leaves later
queued notices eligible for delivery. The draining operation's context records
`socketioBroadcast` cleanup diagnostics with a zero-based `broadcastIndex`;
the call retains its committed outcome and first failure. Failed notices are
not automatically replayed. See the Socket.IO guide for partial-delivery limits.
Managed callbacks defer repeated changes to the same resource until completion.
In-memory notices do not guarantee exactly-once delivery or recovery after
process failure. Verify subscription and notification handling in each application
that uses this plugin.

## Bulk writes

Remove `batchSize` and `enableOptimizations` from plugin configuration, and pass
the remaining options directly:

```javascript
await api.use(BulkOperationsPlugin, {
  maxBulkOperations: 100,
  defaultAtomic: true
})
```

`maxBulkOperations` must be a positive safe integer and `defaultAtomic` a boolean.
Unknown keys now fail installation, including a nested `'bulk-operations'`
wrapper. The removed settings did not batch SQL: `batchSize` only divided a
sequential loop, and the optimization hook never ran. Removing the loop setting
also removes its invalid-value hang/skip paths. Bulk operations still execute
the normal resource methods, including validation, permission checks and hooks.
Atomic requests use one transaction; non-atomic requests complete each record's
transaction separately. No stored-data migration is needed.

Bulk POST replaces `inputRecords` with either `data: plainRecords` or
`document: { data: jsonApiResources }`. Bulk PATCH entries use either
`{ id, data: plainValues }` or `{ id, document: { data: jsonApiResource } }`.
Do not put a JSON:API resource directly inside an operation's `data` field.
Each entry explicitly selects its input; neither bulk method infers it from
`format`. The documented bulk HTTP bodies keep their wire shapes: POST uses
`{ data: [resourceObject, ...] }` and PATCH uses `{ operations: [...] }`.
The connector translates them into these method arguments. Remove raw-array
bulk POST shorthand and arrays of individually wrapped documents; send one
document containing the resource array instead.

Bulk POST/PATCH honor output-only `format` and `returning`, including resource
defaults. Bulk results retain their `meta`/`errors` envelope:
`returning: 'full'` supplies complete records in `data`, `minimal` supplies
identifiers, and `none` omits `data`. Bulk PATCH no longer performs an extra GET
to override a minimal/none return choice.

```js
await api.resources.books.bulkPatch({
  operations: [{ id: '42', data: { title: 'Updated title' } }],
  format: 'plain',
  returning: 'none',
  atomic: true
}, requestContext)
// { meta: { total: 1, succeeded: 1, failed: 0, atomic: true }, ... }
```

`atomic` must be a boolean in direct calls. HTTP accepts `atomic=true` or
`atomic=false`; misspellings now fail with 422 before writing. Removed response
options also fail clearly. Numeric zero is a valid bulk PATCH ID when the
resource's declared ID schema accepts zero.

Install the connector and bulk plugin before declaring resources. Bulk routes
now register through the active scope hook and retain authenticated request
context. They explicitly select full JSON:API records, regardless of
programmatic defaults. POST responds with 201; PATCH and DELETE respond with
200 and the batch summary. The optional plugin reserves the `bulk` path segment
for these methods; do not use it as an opaque resource ID with this plugin.
These endpoints are the library's bulk protocol, not the JSON:API Atomic
Operations extension. An atomic denial rolls back the batch; a non-atomic batch
retains permitted operations and reports denied entries by index.

An atomic batch now keeps its original child, validation or commit error if
rollback also fails. The outer batch attempts rollback once for an unfinished
transaction it owns. Its supplied context exposes the original `error` and any secondary
rollback failure in `cleanupErrors`, using `{ phase: 'rollback', error }` entries.
Both fields are cleared when the context starts another bulk call. A transaction
already completed by the driver is not rolled back; a rejected commit still
does not establish a safe retry. The error wrapper reports the available outcome.
This change does
not add bulk completion hooks or change non-atomic result envelopes.

Child cleanup warnings and failures now survive on the supplied batch context.
`cleanupErrors` entries add a zero-based `bulkIndex` to their existing phase,
original error and file information. This includes warnings from successful
entries, rollback/cleanup-hook failures from rejected entries, and diagnostics
collected before an atomic batch rethrows. Managed completion-chain failures
also identify `operationIndex`, `scopeName` and `method`. Secondary errors remain on the
context rather than being added to the batch response.

Remaining child `fileHandlingUploads` entries also reach the batch context with
`bulkIndex`, preserving storage and transaction references. Context reuse clears
old error diagnostics, retains unresolved upload tracking and starts each new
child with separate tracking. Do not use retained tracking as a deletion or retry
instruction: files can belong to committed data when an earlier `afterCommit`
hook prevents the tracking-release hook from running, or to pending outer work.

For non-atomic results, `meta.failed` counts rejected calls. A post-commit hook
failure can therefore appear as an indexed error even though the write is
committed. Inspect the underlying failure and transaction evidence before
retrying. Each error entry now has `error.transactionOutcome`; remaining managed
integration is tracked separately.
No payload or stored-data migration is required for this diagnostic correction.

Stored file handles also now read as strings when the ordinary SQL driver returns
their UTF-8 bytes as a Buffer. The shared normalizer decodes declared `file`
attributes, including byte views, without changing blob fields or database
columns. Invalid encoding fails with its original cause and field context.
Custom getters retain their raw database input. No schema migration or consumer
Buffer-to-string wrapper is needed; use the resulting URL string directly.

Bulk POST/PATCH/DELETE now honor `transaction` in the first argument; previously
they ignored it and could commit separately from the caller's transaction.
Select `atomic: true` when supplying it, including when the plugin's
`defaultAtomic` is false. Each child and its relationship changes use the same
transaction. The in-progress managed contract requires `api.transaction` to
own the unit. Earlier entries and the failing entry's pending writes roll back
together, including when the callback catches a participating write failure.
Catching the error does not restore those rows or create a savepoint.

```javascript
await api.transaction(async transaction => {
  return api.resources.books.bulkPatch({
    operations: [{ id: '42', data: { title: 'Updated title' } }],
    format: 'plain',
    returning: 'minimal',
    atomic: true,
    transaction
  })
})
```

`atomic: false` with a supplied transaction now fails with
`REST_API_VALIDATION` on `transaction`, before any child or SQL runs. Independent
per-entry completion requires calls without an outer transaction. A supplied
completed transaction also rejects instead of being silently replaced. Calls
without `transaction` keep their atomic/non-atomic ownership. Completion hooks,
file cleanup and notifications use the managed owner. No stored-data migration
is needed for this transaction-ownership change. Check any application wrapper
that supplies raw transactions to bulk methods.

## Application-supplied primary IDs in table helpers

Ordinary table creation, generated migrations and migration diffs now recognize
the declared primary ID by its mapped column, including `integer` and `string`
definitions. Previously only a field with type `id` was recognized; a declared
integer/string primary key could produce a duplicate generated ID column.

For a caller-supplied opaque key, declare the primary key explicitly:

```js
await api.addResource('records', {
  idProperty: 'record_key',
  schema: {
    id: {
      type: 'string', primary: true, required: true,
      storage: { column: 'record_key' }
    },
    name: { type: 'string' }
  }
})
```

The same pattern works with `type: 'integer'`. `primary: true` keeps the
authored column instead of adding an implicit auto-incrementing ID. Supply IDs
when writing to a table without database allocation or a default.
An opaque ID without that primary declaration cannot use implicit numeric
allocation: the helper now rejects that configuration before producing DDL.
For lower-level table definitions, `autoIncrement: false` remains available.

Table snapshots now accept these non-null, single-column integer/string primary
keys without requiring auto-increment or a database default. Existing tables are
not altered by this change. Regenerate migrations that failed with duplicate ID
columns and review the resulting DDL; an unchanged valid table should produce
an empty migration diff. Missing, nullable, floating-point and composite resource
IDs remain rejected by snapshot validation.

## Collection filtering hooks

Collection reads now honor a query builder assigned to
`context.knexQuery.query` by a `knexQueryFiltering` hook. Previously, both storage
modes could ignore that replacement and omit restrictions added to it; ordinary
pagination totals could disagree with the returned page, and canonical totals
could omit the restriction too. Related-resource collections use the corrected
path as well.

When a hook needs a separate builder, clone the supplied query and apply further
conditions to that clone. Keep its tenant/resource constraints, relationship
membership and existing visibility predicates. The selected builder governs the
page. Ordinary storage also runs filtering hooks for its separate count query;
canonical storage clones the filtered collection query for that count. Apply the
complete predicate on every filtering call, including count calls. Surrounding
`context.knexQuery` metadata is restored after filtering succeeds or fails.
Row-policy functions retain their existing
`true`/`false` return contract. This correction adds no public option and requires
no change to hooks that already mutate or replace the supplied builder correctly.

## Full includes and projected fields

Ordinary-storage belongsTo, hasOne and polymorphic belongsTo includes now select
visible SQL projections when no target fieldset is supplied. Previously these
paths could omit the projections and pass missing dependencies to computed
fields. Full and sparse includes now use the same field-selection rules as
collection includes and canonical storage.

No call changes are required. Remove any fieldset used solely to work around
missing projections; keep intentional sparse fieldsets to control response
size. For example, `books.get({ id: '1', queryParams: { include: ['author'] } })`
now returns the author's visible projections without also specifying
`fields.authors`. A projection used only as a computed-field dependency remains
absent from a sparse response unless requested. Projection failures reject the
operation; full write-response failures happen before an owned commit.

### Cyclic includes and resource identity

A resource appears once across a JSON:API document's `data` and `included`.
For example, `items.get({ id: '1', format: 'jsonapi', queryParams: { include: ['groups.items'] } })`
keeps the item in `data` and its group in `included`. The group's relationship
can point back to `items/1` without adding another copy of that item. Relationships
discovered through the cycle are retained on the primary resource, and computed
fields run once per represented resource. Explicit collection include limits
remain in effect when another path revisits the same resource.

If your response resolver searches only `included`, index both primary `data`
and `included` by type and ID instead. Update snapshots that expected a primary
resource to be repeated in `included`. Relationship identifiers and resource URLs
keep their existing shape; this requires no stored-data migration.

Plain responses resolve references against both primary and included resources.
Peers in a primary collection can therefore expand fully. Actual cycles end in
an `{ id }` reference, with `_type` retained for polymorphic relationships;
independent branches still receive separate objects. Keep custom computed
callbacks free of assumptions that a cyclic path will invoke them twice.

### Empty includes and refresh links

JSON:API resource reads and full write responses now retain `included: []` when
an explicit include returns no resources. This also applies to empty collections
and related endpoints with `data: null`. An explicitly empty include is supported:

```js
await api.resources.groups.get({
  id: '1',
  format: 'jsonapi',
  queryParams: { include: [] }
})
// { data: { ... }, included: [], links: { self: '.../groups/1?include=' } }
```

Omitting `include` keeps it absent from normalized query parameters and omits
`included` when there are no included resources. HTTP `?include=` parses as an
explicit empty array and survives serialization into refresh/pagination links.
Hooks and direct parser callers that iterate includes should use
`context.queryParams?.include ?? []`; do not assume an omitted include has been
populated with an empty array. Update response snapshots for explicitly requested
includes that used to omit `included`.

Top-level `links.self` on single-resource and related responses now preserves
includes and fieldsets, as collection links do. Follow that link to refresh the
same representation. Resource-level `data.links.self` remains the resource URL.
Update assertions that assumed those two links were always identical.

Plain results retain their existing shapes. Programmatic `returning: 'minimal'`
and `'none'` retain their selected return contracts; HTTP resource writes select
full JSON:API responses. No method arguments or stored records need migration.

### Relationship visibility hooks

Row policies and `knexQueryFiltering` hooks with
`queryPurpose: 'relationship-identifiers'` now run once per batch of at most
100 unique target IDs for each resource type. Remove assumptions that this is
one callback per request, and remove flags that skip a visibility predicate
after the first query. Add the full predicate to each supplied builder; cloning
that builder remains supported. Keep ordering, pagination and include limits
in the operation/resource settings, and retain the selected ID and mandatory
scope constraints when customizing a visibility query.

Identifier-visibility selections no longer put every ID into one `WHERE IN`. These reads
select distinct IDs, preserve the input linkage order and duplicate occurrences,
and retain the caller's transaction. A later batch failure rejects the whole
read. See the [row-policy contract](17-row-policies.md#query-purposes-and-lifecycle-coverage)
for the context supplied to these hooks.

### Nested belongs-to include batches

Regular and polymorphic belongs-to includes now load at most 100 unique target
IDs per resource type in each query. Large nested includes no longer place all
of those IDs in one SQL statement. Target permission/filter hooks with
`queryPurpose: 'include'` and SQL projection `select` callbacks run for every
batch. Apply the complete predicate or projection each time; remove assumptions
that they run once per include path. This does not change computed-field
callbacks into query callbacks.

All target batches are gathered before traversing nested collections. Existing
global and per-parent collection limits still apply across that complete parent
set. A later batch failure rejects the operation; a failed full write response
rolls back an owned transaction, while a borrowed transaction remains the
caller's responsibility. Canonical storage also batches parent-link prefetches.
This change adds no method options and does not impose a total response-memory
bound or batch every collection include query.

### Large collection identifier queries

Collection includes and relationship-metadata reads now deduplicate their ID
lists. Above 100 distinct IDs, PostgreSQL receives one array parameter and
SQLite receives one JSON array parameter through JSON1. Sorting, global limits,
per-parent limits and policy predicates still run in the original SQL query.
SQL projection and filtering callbacks retain their collection-query frequency.
The separately batched belongs-to loaders retain the behavior described above.

Code that inspects raw Knex statements must allow array predicates and ID
subqueries; use the documented query-purpose/context fields when applying
policies. Small lists keep ordinary `IN` predicates. MySQL retains its ordinary
`IN` query through Knex's text protocol, preserving its existing numeric and
collation comparisons. These changes add no public options. They avoid database
parameter-count overflow, but complete ID lists and responses still consume
memory proportional to their size.

### Explicit includes and linkage reads

An explicitly included relationship is now loaded directly by its include
loader. The library skips the preliminary identifier read that the loader used
to replace afterward. For standard many-to-many includes, authorized target
records are selected and limited in SQL before the library reads their parent
mappings. Window includes keep their per-parent limit behavior. Result ordering,
duplicate-edge handling, sparse fields and transaction ownership remain the same.

Hooks observing `relationship-identifiers` queries will see fewer calls for
explicitly included relationships. Target and ordinary pivot include permission
checks still run. Mapping reads now occur after the target query, on the same
transaction; a mapping-read failure still fails the operation. Complete unlimited
includes can require additional mapping pages. No API option or data migration
is needed.

### Sparse responses and relationship hooks

Sparse fieldsets now avoid database reads for omitted relationship linkage in
both storage modes. For example, `queryParams: { fields: { books: 'title' } }`
does not load the book's collection identifiers or check visibility of to-one
linkage that will be removed from the response. Selected linkage retains its
visibility checks. Requests without a fieldset for that resource keep their
existing linkage behavior.

An explicit `include` still loads its resources even when the corresponding
relationship field is omitted. Nested includes, target permissions, computed
attribute dependencies and transaction ownership retain their existing behavior.
No new option is needed.

If a hook reads collection linkage from `context.record`, request that
relationship in the resource's fieldset or load the data explicitly for the
hook's purpose. Do not use the number of `relationship-identifiers` filtering
hooks as a request notification: omitted linkage no longer triggers those reads.
Authorization for requested primary/included resources still runs; authorization
must not depend on an incidental query for an omitted relationship.

### Canonical parent-link reads

Canonical many-to-many linkage now reads at most 101 physical link rows per
query, retaining its existing 100-parent batch size. It still returns complete
visible linkage. Raw linkage is assembled in physical link-ID order for each
parent; use declared include ordering or related-resource query sorting when
application order matters. Configured include limits and ordering still apply
to the complete requested parent set.

The prefetch now also enforces the relationship's declared target resource type,
matching the existing related-resource query. A same-key physical link to a
different resource no longer appears in this relationship. No method option or
data migration is needed. Later page failures reject the operation and preserve
the existing owned/borrowed transaction behavior. Raw SQL observers should expect
additional reads for large link collections.

### Ordinary pivot membership writes

Many-to-many additions and replacements now read existing pivot rows for at
most 100 requested target IDs at a time, paging duplicate physical edges in
bounded results. New inserts still use batches of 100 rows. Replacement deletes
unwanted rows using one predicate for the complete desired set, including large
SQLite/PostgreSQL ID lists. Retained matching pivot rows keep their IDs and
metadata. Empty replacement removes every link for that owner.

Equivalent requested target IDs, as resolved by the database's target ID column,
are written once using the first submitted spelling. For example, `BETA` and
`beta` referring to the same target no longer create two new pivot rows in one
request. Existing duplicate rows are not merged automatically. Keep target ID
and pivot reference column types/collations consistent; this does not migrate
existing application schemas.

Method arguments, permission hooks and transaction ownership are unchanged.
Code that observes raw SQL must allow paged pivot reads and a single exclusion
DELETE for replacement. The complete input and keep-list still require memory
proportional to their size; the batching does not set a new relationship limit.

## Relationship target validation

POST, PUT and PATCH payloads, including relationship endpoints, now use one
target-validation contract. Readable target rows are selected in batches of at
most 100 distinct identifiers; `checkPermissions` then runs with `method: 'get'`
for each distinct target within each relationship. Its `originalContext`
contains that target's `id`, `scopeName`, `schemaInfo` and `minimalRecord`, plus
the caller's auth and transaction. Repeated identifiers do not repeat permission
checks within one relationship. A target referenced through two relationships
is checked for each relationship.

Many-to-many writes no longer run a full target GET after this check. Move any
link-authorization logic from `checkDataPermissionsGet`, `beforeDataGet`, getters,
computed fields, enrichment or `finishGet` into the existing permission hook:

```js
checkPermissions: {
  functionName: 'authorize-readable-target',
  handler: ({ context }) => {
    if (context.method !== 'get') return
    const request = context.originalContext
    assertCanRead(request.auth, request.minimalRecord)
  }
}
```

The minimal record contains stored attributes and to-one linkage; it has no
response getters/computed fields or includes. Response hooks still run for real
GETs and requested full write responses. Use write/transaction hooks for side
effects of linking. Remove assumptions about one target GET per supplied ID.

Row policies and `knexQueryFiltering` run with
`queryPurpose: 'relationship-validation'`, empty client filters and no individual
`context.id`. Add the complete row predicate to every supplied builder. Retain
its selected ID and mandatory scope constraints; the filtered ID subquery
selects the full minimal rows without multiplying them through policy joins.
An alternate-spelling lookup can run an additional scoped query to retain the
database's ID collation semantics. Per-target decisions belong in the permission
hook, where the individual ID and record are available.

Target locks and storage existence checks remain. A failure rejects before
link writes; an owned operation rolls back, while a borrowed transaction stays
with its caller. Internal pivot/link storage helpers now assume the resource
operation has authorized its payload; applications should use resource methods.
No option retains the old target GET lifecycle. Port application hooks that
relied on those implicit reads.

## Setter, getter and computed-field failures

Field callbacks now propagate failures in both formats and storage modes,
including primary resources, included resources and nested includes. There is
no additional policy option. The changes are:

| Callback failure | Previous behavior | Current behavior |
| --- | --- | --- |
| Unexpected setter error | Converted to validation error (422), losing its cause | Operation rejects with the original cause; HTTP 500 |
| Unexpected getter error | Logged; response kept the current field value | Operation rejects; HTTP 500 |
| Unexpected computed-field error | Logged; response substituted null | Operation rejects; HTTP 500 |
| Typed API error | Propagated at field callbacks | Unchanged on reads; retained as the write wrapper's cause, with code/details still readable |
| Relationship target permission failure | Could be replaced with not-found (404) | Original classification/cause retained by target validation; a missing target still produces 404 |

In the cause chain, unexpected callback errors have `cause` and
`context: { scopeName, fieldName, phase }`, where `phase` is `setter`, `getter`
or `computed`. Include processing can add outer wrappers; follow the cause
chain to the field error. Synchronous throws and asynchronous rejections follow
the same rule, including non-Error values such as null or undefined.

If a setter intentionally rejects user input, change its generic throw to the
existing validation error class. For example, inside a resource schema:

```js
import { RestApiValidationError } from 'json-rest-api'

const quantityField = {
  type: 'number',
  setter: value => {
    if (!Number.isInteger(value)) {
      // Previously: throw new Error('Quantity must be a whole number')
      throw new RestApiValidationError('Quantity must be a whole number', {
        fields: ['data.attributes.quantity'],
        violations: [{
          field: 'data.attributes.quantity',
          rule: 'integer',
          message: 'Quantity must be a whole number'
        }]
      })
    }
    return value
  }
}
```

This keeps intentional input rejection at 422. A typed forbidden resource
error remains 403. Unexpected programming or service failures should propagate.
When a value is intentionally unavailable, return that domain value explicitly:

```js
const helpfulnessField = {
  type: 'number',
  computed: true,
  dependencies: ['helpful_votes', 'total_votes'],
  compute: ({ attributes }) => attributes.total_votes === 0
    ? null
    : 100 * attributes.helpful_votes / attributes.total_votes
}
```

A callback's own intentional fallback still works. Review existing generic
validation throws and code that depended on the library substituting null or
returning an untransformed value. Handle rejected reads and writes instead of
treating an incomplete response as success.

GET/query return no successful partial response after an executed callback
fails. POST/PUT/PATCH full-response enrichment runs before owned commit, so its
failure rolls back owned record and relationship changes. Borrowed transactions
remain active for their owner to complete. Minimal/none responses do not run
callbacks solely to enrich an unused full response; callbacks needed for other
work, such as validating related resources, still run and can fail the write.
Sparse fieldsets likewise avoid callbacks that are neither selected nor needed
as dependencies. These rules do not undo a write whose commit was already
acknowledged; post-commit side effects and cleanup retain their own semantics.

## Stored relationship metadata

Canonical reverse relationship linkage now selects only child identity and
parent-reference columns. Large target attributes are no longer fetched merely
to construct linkage. Returned IDs, filters and transaction ownership are
unchanged. Query hooks for `queryPurpose: 'relationship-identifiers'` should
preserve these selections when replacing the builder; add predicates against
the underlying columns as usual. No payload or data migration is needed.

Polymorphic linkage read from storage must use a target type declared by its
relationship. For example, with
`subject: { belongsToPolymorphic: { types: ['groups'], ... } }`, a stored
`subjectType: 'items'` is invalid even if an `items` resource exists. Previously
ordinary includes could silently omit that target, while canonical storage
could include it. Both modes now reject with HTTP 500 and programmatic error
context `{ scopeName, relationshipName, phase: 'relationshipData' }`.
This also applies to linkage returned without an include. A disallowed target
submitted through the write API still produces a validation error (422).

Repair inconsistent stored type/ID pairs or update the declared relationship
when the target type is intentional. Nullable, intentionally empty
relationships retain their existing representation. Sparse fieldsets do not
guarantee bypassing stored-linkage checks: preliminary reads and relationship
selection can still require those columns.

Required reverse-relationship metadata must also exist: a `via` relationship
must refer to a polymorphic relationship, and canonical foreign-key mappings
must resolve to a stored field. Missing required metadata now rejects instead
of returning empty linkage. Correct the resource declaration or stored
canonical metadata, then retry. Schema-read failures during field selection
and record conversion retain their original cause and resource context with
phase `relationshipMetadata`; they are no longer ignored as if the resource
had no relationships.

Nested polymorphic include paths can still apply to only some declared target
types. If `subject` allows `writers` and `books`, and only writers have a
`profile`, `include=subject.profile` remains valid; books simply have no profile
branch. A path supported by none of the declared target types is rejected by
request validation.

These read checks also apply while preparing write responses. A failure before
owned commit rolls back the owned write; a borrowed transaction remains its
owner's responsibility. An acknowledged commit cannot be undone by a later
response or side-effect error.

## Schema enrichment and canonical registration

Use `schema:enrich` to change attribute definitions. Use `searchSchema:enrich`
to change filter definitions. Previously the search hook received the attribute
map in `context.fields`, so edits could affect writes while failing to change
filter validation. It now receives the generated search map, including explicit
search aliases. Adding, editing, deleting or replacing `context.fields` affects
the search contract. The hook also runs when the initial search map is empty.

```js
await api.customize({
  hooks: {
    'schema:enrich': {
      functionName: 'declare-product-stock',
      handler: ({ context }) => {
        if (context.scopeName !== 'products') return
        context.fields.stock = { type: 'integer', defaultTo: 0 }
      }
    },
    'searchSchema:enrich': {
      functionName: 'declare-product-filters',
      handler: ({ context }) => {
        if (context.scopeName !== 'products') return
        context.fields.nameContains = {
          type: 'string', actualField: 'name', filterOperator: 'contains'
        }
      }
    }
  }
})
// Register resources after installing their schema hooks.
```

Treat `originalFields` as inspection input; edit `fields`. Definitions are
shallow copies, so this is not a guarantee of deep immutability. Search index
hints are applied to the hook's final result. A search-only alias is not a
writable attribute.

Both storage modes now use the enriched compiled field definitions. Canonical
registration previously persisted raw authored definitions and then overwrote
some enriched metadata. It now allocates storage from compiled definitions and
attaches its descriptor to the same compiled schema. This preserves types,
removed/added fields, search overrides and callbacks without a second schema
compilation. Canonical metadata no longer invents an attribute declaration for
an implicit resource ID; metadata consumers should use `schemaInfo.idProperty`
to identify the resource ID configuration.

Enrichment runs once at resource registration, and once for each canonical
`addKnexFields` compilation. Repeated canonical `createKnexTable()` refreshes
storage metadata without rerunning enrichment or restoring removed search
fields. Deep registry allocation does not update a running resource's compiled
schema; use the resource helper and retain its expanded declaration in source.
Declare callbacks in source again after restart: persisted JSON cannot restore
functions. Ordinary `addKnexFields` retains its DDL-only behavior.

Fastify now resolves the current cached request contract when validating a
payload. A belongs-to alias added through canonical `addKnexFields` can be used
in resource POST/PUT/PATCH documents after server startup, as with Express and
programmatic calls. The JSON Schema published at route registration remains an
initialization snapshot; finalize declarations before generating route-based
API documentation.

### Computed-field enrichment

Plugins that derive computed fields from schema metadata should use
`computedSchema:enrich` instead of adding fields to `vars.schemaInfo.computed`
in `resource:added`. The compiler awaits this hook after attribute and search
enrichment, including during canonical field additions. Edit or replace
`context.fields`; each definition must have `computed: true` and a `type`,
and any supplied `compute` callback must be a function. Computed names cannot
collide with stored attributes.

This validation also applies to authored computed fields. `compute: false`,
`0`, `null` and `''` previously registered successfully but silently omitted
the field from output. They now fail registration with `invalid compute
function`. Supply a function, or omit `compute` when an `enrichAttributes`
hook intentionally supplies the value.

```js
await api.customize({
  hooks: {
    'computedSchema:enrich': {
      functionName: 'derive-product-summary',
      handler: ({ context }) => {
        if (context.scopeName !== 'products') return
        context.fields.summary = {
          type: 'string',
          computed: true,
          dependencies: ['name'],
          compute: ({ attributes }) => `Product: ${attributes.name}`
        }
      }
    }
  }
})
```

The context also exposes `originalFields` (authored computed declarations),
`schemaStructure`, `searchSchemaStructure`, `schemaRelationships`, `idProperty`, `scopeName` and
`scopeOptions` for inspection. Change stored fields in `schema:enrich` and
search fields in `searchSchema:enrich`; the computed hook's other structures
are inspection inputs, not an alternative configuration mutation API.
Definitions are shallow copies, not deeply immutable objects.

LabelPlugin now uses this stage. Automatic labels survive canonical field
additions and use the newly compiled search/preference candidates. Explicit
stored or computed labels remain authoritative. If computed enrichment or
validation fails during canonical `addKnexFields`, the candidate is rejected
before field allocation; existing compiled metadata and records remain usable.

### Existing canonical data

Registration now rejects removal or remapping of an existing stored field when
the resource has records. The error starts with `Canonical storage migration
required` and identifies the field. An owned registration rolls back metadata
changes; a borrowed registry transaction remains the caller's responsibility.
This guard prevents a changed schema order or newly effective enrichment hook
from silently reading one field's existing slot as another field.

Before upgrading an app with existing canonical data:

1. Inspect its schema hooks and compare their final field types with persisted
   field definitions and `canonicalFieldMap`.
2. Keep every existing stored field in the declaration. For changes that retain
   the same storage types, preserve existing slot assignments with an explicit
   complete `canonicalFieldsMap`; allocate unused slots for new fields.
3. If a field needs a different slot pool, a new value encoding or removal,
   migrate and verify its data and metadata explicitly before registering that
   changed layout. A slot map cannot convert values between storage types.
4. Restart with the expanded schema, callbacks and slot map, then verify old
   records, new writes, filters and relationship linkage.

Registration is not a data migration. The layout guard does not verify semantic
changes to callbacks or values that retain the same physical slot. Empty
resources can change layout without this guard rejecting registration.

Older canonical registrations could also allocate an undeclared numeric field
named after a custom `idProperty`. That synthetic field is no longer allocated.
If its removal triggers the guard, inspect the old slot and metadata in your
data migration. Remove its field configuration/schema entry only after proving
the slot has no values to preserve, and retain every real field's slot map.
Do not add a fake attribute merely to retain the unused allocation.

## Write hooks and the returned response

POST, PUT and PATCH prepare their response before committing an owned
transaction. `finish`, then `finishPost`/`finishPut`/`finishPatch`, are the last
hooks that can customize `context.responseRecord`. The library then normalizes
schema-declared values and reapplies requested sparse fieldsets to full output,
including related records. A finish hook cannot expose an excluded field by
adding it after the nested GET. Minimal responses retain their resource type
and ID; `returning: 'none'` still returns undefined.

The returned minimal/full response is now a detached snapshot. `afterCommit`
is awaited for external side effects, but mutations to its context or response
do not rewrite the prepared result. Move response changes from `afterCommit`
into the appropriate finish hook. For example, JSON:API response metadata can be
added with:

```js
await api.customize({
  hooks: {
    finishPost: {
      functionName: 'add-write-metadata',
      handler: ({ context }) => {
        if (context.format !== 'jsonapi' || context.returning !== 'full') return
        context.responseRecord.meta = { requestId: context.requestId }
      }
    }
  }
})
```

Use data in response extensions and metadata, not functions or live application
objects. The snapshot uses `structuredClone`; a non-cloneable extension rejects
before commit, with owned transactions rolled back and borrowed transactions
left to their owner. This does not add validation of arbitrary JSON attributes
or metadata. Schema-declared temporal fields still use their existing conversion
rules. A failing `afterCommit` hook still rejects after the database has committed;
the error reports `committed`.

POST, PUT and PATCH clear any ID left by a previous operation before processing
hooks run. POST's generated ID becomes available as `context.id` at
`afterDataCallPost`, and remains available to later hooks and the nested response
GET. Before insertion, a caller-supplied ID is available in
`context.inputRecord.data.id` after input conversion. PUT and PATCH assign their
validated target ID before `beforeSchemaValidate`. Early processing hooks can
inspect the current request in `context.params`; they must not use a previous
operation's ID.

## Direct imports of the setter helper

Resource declarations and setter callback arguments keep their existing shape.
If application code directly imported `applyFieldSetters` from the internal
resource-method `common.js`, update its call:

```js
// Before: assign the helper's returned attributes.
context.inputRecord.data.attributes = await applyFieldSetters(
  context.inputRecord.data.attributes, context.schemaInfo, context, api, helpers
)

// Now: the helper assigns the transformed attributes to this write context.
await applyFieldSetters(context, api, helpers)
```

The helper returns no value. It runs setters at the same point, after validation
and before storage, without completing the transaction. Applications using
public resource calls need no change for this internal simplification.
The [lifecycle guide](13-hooks-and-lifecycle.md)
documents the retained hooks and their ordering.

## Application rollout and experimental features

Coordinate dependency versions, consumer repositories, generated code and seeds
before upgrading applications. Run their actual workflows against the intended
package set. Library-side verification does not establish consumer compatibility.

The local dispatcher preserves null/undefined throws; see [transaction outcomes](20-transaction-outcomes.md).
[Positioning](31-positioning.md) now coordinates writes through database locks;
its chapter describes tested concurrency and remaining storage requirements.

### Positioning coordination and retired placeholders

Existing resource calls using `beforeId`, `null` for append and `'FIRST'` continue
to work. PostgreSQL and MySQL writers serialize through a transaction-owned
coordinator row, including empty groups and moves between groups. SQLite can
report busy conflicts; stale transaction snapshots can reject. Applications must
retry a failed move in a fresh operation/transaction when appropriate.

Installation creates `json_rest_api_positioning_locks` if absent. Provision the
table before deployment when the runtime account lacks DDL permission, and keep
all cooperating writers on the same table. The [positioning guide](31-positioning.md)
contains its schema and collation requirements.

- Changing a group without `beforeId` now places the record at the configured
  beginning/end of its destination group instead of retaining a potentially
  duplicate key. Same-group updates preserve their position.
- PUT creates receive positions, and PUT replacements preserve or recalculate
  their managed position. Other persisted fields still follow complete PUT
  replacement rules.
- Missing/out-of-group targets append; a self-targeted move stays in place.
  Explicit targets now use normal GET permissions and visibility.
- Default query ordering uses the supported query hook. Bytewise collation on
  position columns is required for ordinary sorting and cursor pagination;
  the allocator's binary comparisons do not change those query semantics.
- Remove `rebalanceThreshold`; it never caused automatic rebalancing and now
  rejects. The no-op `api.positioning.reorder()` method has been removed. Use
  ordinary PATCH calls or atomic bulk PATCH for actual changes.
- Existing keys must be valid fractional keys. Key exhaustion rejects before
  exceeding declared storage length; migrate/rebalance the data deliberately.
- Deep imports of `calculatePosition()` now take `(previousPosition, nextPosition)`
  string bounds. The former array/ID arguments are no longer supported.

## Native query builders and explicit custom-filter translation

Both storage modes now give query hooks a native Knex builder. Canonical storage
no longer intercepts Knex methods to guess logical field/table names. This removes
the old query proxy, its alias/descriptor traversal and its partial emulation of
Knex methods. Keep the supplied scoped builder (or clone it) and use explicit
column/value translation. Native Knex joins, callbacks, aliases, aggregates, raw
bindings and cloning retain Knex's own behavior.

Custom search filters now receive a third argument:

```js
customRank: {
  type: 'number',
  applyFilter(query, input, { column, value }) {
    query.where(column('rank'), '>=', value('rank', input))
  }
}
```

Replace `query.where('rank', '>=', input)` with this form when `rank` is a logical
resource field. `column(field)` returns a qualified physical column, including
canonical slots or an explicitly mapped ordinary column. `value(field, input)`
applies that field's storage conversion/custom serializer. The validated public
filter input remains the second argument; it is not automatically reinterpreted
as another field's stored value. The details object also supplies `context` and
`scopeName`. The callback's `this` remains the same builder as its first argument.

For a declared joined filter such as `actualField: 'groups.code'`, use
`column('groups.code')` and `value('groups.code', input)`. These helpers resolve
the declared path's prepared alias; they do not create arbitrary additional
joins. Existing related-query permission checks still run. Custom SQL continues
to own any extra relationships or visibility semantics it introduces. Callbacks
run synchronously inside the current predicate group and must mutate that
builder; returned builders/promises are not awaited or selected.

For `knexQueryFiltering` hooks, the existing
`createStorageAdapterUtilities({ context })` helper supplies
`translateColumn(scopeName, field)` and `translateFilterValue(scopeName, field,
input)`. Keep using `context.knexQuery.tableName` as the active SQL alias and
`context.knexQuery.storageAdapter` for resource storage operations. The legacy
`context.knexQuery.adapter` now refers to that same storage adapter in both
modes; it is no longer a query-method proxy. Removed private proxy state includes
`__adapter__`, its related-descriptor/alias maps, and
`context.resourceToTableName`. Importing the removed internal
`anyapi-query-adapter.js` module is no longer supported.

A filtering hook can translate a local field without importing another helper:

```js
handler({ context }) {
  const { query, tableName, storageAdapter } = context.knexQuery
  const rankColumn = `${tableName}.${storageAdapter.translateColumn('rank')}`
  query.where(rankColumn, '>=', storageAdapter.translateFilterValue('rank', 10))
}
```

Apply this predicate to the supplied query, including count invocations. Keep
using declared cross-resource search paths where possible; writing a native join
does not automatically add the target resource's permission or visibility checks.

The storage adapter's `buildBaseQuery({ transaction, tableAlias })` constructs a
native builder with the optional alias and retains canonical tenant/resource
predicates qualified by that alias. It borrows the database handle and does not
complete transactions. Translate every logical identifier used in custom SQL;
raw SQL text and binding strings are not rewritten. Consumer repositories have
not been migrated by this library-only change.

## Storage helpers consume prepared write attributes

Ordinary PUT/PATCH no longer re-extract belongs-to values from the request's
relationship object. Core relationship processing and setters already prepare
`context.inputRecord.data.attributes` before calling storage, as they do for
POST and canonical writes. Resource API calls need no migration for this change.
Custom storage implementations should consume those prepared attributes before
applying physical storage mapping, preserving setter results.

A custom `dataPost` helper must return a nonempty string, a finite number, or a
bigint ID. The lifecycle converts bigint IDs to strings without losing precision.
Invalid helper results reject before `afterDataCall` hooks and roll back the
write, including with `returning: 'none'` or `'minimal'`. Resource `normalizeId`
is not invoked again on the helper's result.

The unexported internal `plugins/core/lib/writing/knex-json-api-transformers-writing.js`
module and its `processBelongsToRelationships` helper have been removed. If you
imported that file directly, remove the second relationship conversion and use
the prepared attributes supplied to your storage callback. Public relationship
validation and authorization remain in the resource lifecycle.

## Pass explicit field maps to foreign-key inspection

The internal `getForeignKeyFields(fields, relationships)` helper accepts a field
map. If an extension passes a schema instance, change the call to
`getForeignKeyFields(schema.structure, relationships)`. Library callers already
pass `schemaInfo.schemaStructure` or an enrichment field map.

The helper no longer guesses whether a property named `structure` is a wrapper.
That guess misread a legitimate attribute named `structure`, hid relationship
backing fields and could bypass the prohibition on identity serializers. Public
resource declarations can continue to use `structure` as an attribute name.

## Table helper schemas use an explicit structure wrapper

Direct calls to `createKnexTable`, `addKnexFields`, `alterKnexFields`,
`generateKnexMigration` and `generateKnexMigrationDiff` now require a schema
object whose `structure` property contains field definitions. A
`json-rest-schema` schema instance already supplies that property and remains
accepted. Field definitions must be objects.

Change bare field maps at the schema argument:

```js
// Before
await alterKnexFields(knex, 'books', { title: { type: 'string' } })

// After
await alterKnexFields(knex, 'books', {
  structure: { title: { type: 'string' } }
})
```

For helpers that accept table metadata, keep `storage`, `indexes`, `foreignKeys`
and `checkConstraints` beside `structure`. Fields with those names belong inside
`structure`, like any other field. Add/alter helpers still reject top-level table
constraints they cannot apply; use a migration diff for those changes.

Public resource calls such as `books.addKnexFields({ fields })`,
`books.alterKnexFields({ fields })` and `books.createKnexTable()` keep their current
arguments. The plugin supplies the explicit helper schema internally.

Bare maps are rejected before SQL or migration output is produced. This removes
the ambiguity that could interpret a field named `structure` as a wrapper and
generate columns from its definition's `type` and `nullable` properties.

## Read helpers use compiled field maps

Internal response, include and field-selection helpers now read
`scope.vars.schemaInfo.schemaStructure` directly. Extensions supplying synthetic
resource metadata must provide that field map alongside `schemaRelationships`;
`schemaInstance` is the validation object, not an alternate field-map argument.
Normal registered resources already provide both compiled values.

The internal `getSchemaStructure` export from `knex-constants.js` is removed.
Use the resource's compiled `schemaStructure`, or explicitly access `.structure`
on a schema instance you own. No wrapper guessing or compatibility adapter is
needed.


## Schema compilation snapshots declarations

Resource schema compilation now copies declaration data on entry and again when
publishing its result. Changing an original field's nested `storage`, validation,
relationship or dependency declaration after registration no longer changes the
currently compiled schema. Enrichment hooks may mutate or replace their supplied
fields during compilation; retaining that object and editing it after the hook
pipeline finishes no longer changes published metadata.

Declare changes before registration, or use the supported schema operation such
as canonical `addKnexFields()` while application operations are stopped. Do not
use mutations of `resource.vars.schemaInfo` as a configuration API. Each explicit
compilation uses its supplied input; this does not add automatic invalidation,
concurrent reconfiguration, or a general resource-customization API.

Callbacks retain their identity and may still access application state through
closures. Plain objects, arrays, dates, regular expressions and nested schema
instances are copied; nested schemas retain their registered type/validator
handlers and operation definitions. Other class instances remain application-owned
references. The library does not freeze caller-owned objects or attempt to clone
external services. This boundary applies to compiled declarations; it does not
turn all runtime options, hook variables or application state into immutable data.


Canonical registration also keeps an owned copy of declarations for later field
additions. Changing the original registration object, or a previous
`addKnexFields({ fields })` input, does not silently change existing fields during
a subsequent addition. Pass new declarations to the supported operation instead.

Initial `sortableFields` and `defaultSort` arrays are copied into resource
variables. Editing the original arrays no longer changes query behavior. An
explicit assignment such as `resource.vars.defaultSort = ['-name']` still affects
subsequent requests; this is a runtime variable override, not a schema change.
It does not recompile fields or change their query eligibility.


## Plugin registries require explicit entries

Named row policies, autofilter resolvers and autofilter presets must be registered
as own entries of their configuration maps. Inherited names such as `constructor`
or `toString` no longer count as registered entries; resource registration rejects
them as unknown. Autofilters also require an actual declared schema field rather
than accepting inherited object properties as fields.

Explicitly registered policy, resolver and preset names remain valid, including
prototype-like names. Use computed properties or `Object.fromEntries()` if a map
key is `__proto__`, so it is an own entry rather than JavaScript object-literal
prototype syntax. Explicit resolver names are also retained in plugin
introspection. Policy and resolver callbacks still run per request; their return
values and authorization results are not cached by this change.


## When configuration changes take effect

| Configuration | Effective boundary | How to change it |
| --- | --- | --- |
| Named policy/resolver maps and autofilter presets | Plugin installation captures entries and preset declarations; resource registration selects them | Supply the intended registry before installing the plugin. Callback closures may still read current application state. |
| Fields, validation, search, relationships, projections and computed declarations | Awaited resource registration compiles and publishes an owned snapshot after enrichment | Declare them before registration. Finish registering forward-referenced resources before serving operations. |
| Enrichment hook fields | Mutable during the corresponding compilation stage | Edit `context.fields`; `context.originalFields` remains a separate view of that stage's original nested declaration data. Install enrichment hooks before registering resources. |
| Runtime hook/helper/variable customization | A subsequent method invocation observes the current customization | Use `api.customize()` for runtime hooks/helpers/global variables. Resource variable overrides remain explicit; they do not recompile schema facts. |
| Response defaults, query default/max limits, include depth and allowed sort fields | Read for each operation; method parameters override the defaults where that method supports an override | Change runtime variables deliberately. Include-depth and allowed-sort changes replace the retained request contracts; format and page-default changes do not require a new schema or adapter. |
| Canonical field additions | Successful metadata commit followed by publication of the new compiled resource | Use `addKnexFields()` while application operations are stopped. Existing source declarations and previous addition inputs are owned copies. Failed additions retain the prior published resource. |
| Descriptor-only mapping refresh | Explicit refresh after the committed mapping migration | Follow the earlier canonical migration instructions; registry eviction alone does not republish an active resource. |

`api.customize()` is not a schema replacement API. Arbitrary writes to
`scopeOptions`, compiled `schemaInfo`, descriptors or canonical maps are not
supported configuration operations. Structural changes outside the supported
addition path need updated source declarations, any required data/schema migration,
and resource initialization. Concurrent structural reconfiguration is unsupported.
There is no automatic fingerprinting of mutable metadata or cache of caller
permissions, resolver values or query results.


## Compiled output definition indexes

Response normalization now reads `resource.vars.schemaInfo.outputFields` and
`outputRelationships`. These are compiled lookup indexes over the existing field,
computed, projection and relationship definitions. They are refreshed with the
compiled resource, including after supported canonical field additions.

Ordinary resource calls need no changes. Code that calls the deep
`normalizeRecordAttributes()` helper with handcrafted scope metadata must supply
these indexes; the helper no longer rebuilds them from `schemaStructure`,
`computed`, `queryFields` and `schemaRelationships` for every record. Prefer passing
real `api.resources`. For a single attributes object with an explicit definition
map, `normalizeAttributes(attributes, definitions)` remains available unchanged.
Direct mutation of compiled indexes is not a configuration API.

## Compiled foreign-key membership

Code constructing synthetic `schemaInfo` for deep query/conversion helpers must
provide `foreignKeyFields`, a `Set` of logical backing-field names for ordinary
and polymorphic relationships. Obtain this metadata from the registered resource
where possible. Compilation publishes the set with the resource; do not mutate
it or add resource IDs to it. Make a local copy when extending identity fields.
Supported canonical field additions publish a replacement set automatically.
The public resource call syntax is unchanged by this optimization.

Conversion no longer reads relationship declarations to reconstruct polymorphic
backing-field membership. Supply both type and ID backing fields in the compiled
set when constructing synthetic metadata. The conversion error boundary wraps
failures while reading that set, retaining typed errors and original causes.

## Relationship aliases must be unique

Each relationship name must have exactly one declaration. Two `belongsTo` fields
cannot share an `as` name, and a field's `as` cannot also appear in the resource's
`relationships` map. Previously these configurations were accepted but different
operations could choose different definitions or cardinalities.

Give distinct relationships distinct names, for example `authorId` with
`as: 'author'` and `reviewerId` with `as: 'reviewer'`. Declare a belongs-to
relationship on its backing field; remove a duplicate declaration from the
`relationships` map. Update payload and include names if you rename an alias.
The compiler checks enriched declarations too. A rejected canonical field
addition retains the previously published resource and its stored data.

## Derived attributes cannot declare relationships

Computed fields and SQL query projections cannot declare `belongsTo` or
`belongsToPolymorphic`. These fields produce attribute values and do not provide
the stored backing fields required by relationship operations. Previously the
compiler accepted these options and could produce inconsistent relationship
lookup and output normalization. The same rejection applies after enrichment.

Remove relationship options from derived attributes. Declare an ordinary
relationship on its stored foreign-key field using `belongsTo` and `as`; declare
a polymorphic relationship in the resource's `relationships` map, identifying its
stored type and ID fields. Give a derived display value its own attribute name.
A rejected canonical addition keeps the previously published schema intact.

## Compiled relationship lookup and polymorphic declaration location

`findRelationshipDefinition()` now reads the registered resource's
`schemaInfo.outputRelationships` index. Deep-helper callers constructing synthetic
metadata must supply that index, including both ordinary belongs-to aliases and
declared relationships. Entries reference the existing definitions. Prefer the
compiled metadata on `api.resources` and do not mutate its lookup index. The
helper returns null for absent names, including inherited object names.

Declare `belongsToPolymorphic` in the resource's `relationships` map, with its
`typeField` and `idField` pointing to stored schema fields. Placing it inside an
individual stored field is now rejected, including after schema enrichment and
when adding canonical fields. Previously that placement was accepted but lookup
could not find the relationship and its backing fields were not recognized.
Move the relationship definition into the map; keep its backing fields in
`schema`. No stored data conversion is needed merely to move the declaration.

## Request contracts reuse compiled relationship metadata

Deep callers of `getRequestContracts()` constructing synthetic `schemaInfo` must
provide `foreignKeyFields` and `outputRelationships` along with their stored and
search schema metadata. Normal registered resources already provide these facts.
The foreign-key set excludes relationship backing fields from writable attribute
contracts; the relationship index supplies linkage cardinalities and target types.
There is no fallback that reconstructs these indexes from raw declarations.

For an ordinary belongs-to relationship, its `belongsTo` value determines the
allowed resource type, consistent with relationship operations. An additional
`target` property does not override it. Use `target` for has-one/has-many and
many-to-many declarations. Existing public call syntax and the one-retained-variant
request-contract cache are unchanged by this refactor.

## File upload rules follow compiled resource configuration

File handling now reads the compiled stored fields, including MIME/size rules
produced by `schema:enrich`. Mutating the original declaration after registration
no longer changes those rules. Installing the file plugin after resource
registration also discovers existing compiled file fields. Supported canonical
field additions refresh the file-field list when the compiled resource changes;
a rejected addition keeps the previous rules, including an empty file-field list.

File storage backends are external handles. A file field's `storage` object with
an `upload()` method retains its identity and method receiver during declaration
snapshotting, so backend state and intentional method replacement continue to
work. MIME and size declarations are still owned snapshots. Ordinary column
mapping objects without `upload()` remain copied declarations. Directly mutating
published compiled metadata is unsupported.

## New compiler hook: `schema:compiled`

Plugins can derive resource metadata in `schema:compiled`. It receives
`context.scopeName`, `context.scopeOptions` and `context.schemaInfo` after core
field, relationship, storage, query and dependency compilation. Read the compiled
facts and attach plugin-owned metadata under a distinct key on `schemaInfo`.
Change stored, search, computed or projected declarations in their existing
enrichment hooks; core compiled facts are read-only at this stage.

The candidate is published only after all handlers succeed, using an owned
snapshot. Retained candidate objects cannot mutate the published metadata.
Throwing rejects registration or a canonical field-addition candidate before it
replaces the resource. This hook runs on compilation, not on ordinary requests
or a descriptor-only refresh.

Autofilter uses this hook to validate and derive its configuration on every
compilation. Resolver metadata and write stamping follow enriched relationship
aliases after canonical additions; removing a required autofilter field rejects
the candidate. `api.autofilter.getScopeConfig(name)` is unchanged. Deep readers of
`resource.vars.autofilter` must move to `resource.vars.schemaInfo.autofilter` or
prefer the public inspection helper. The root registry summary remains available
through `api.autofilter.getConfig()`. No forwarding metadata copy is kept.

## Include configuration is validated before publication

Include configuration is now checked from the compiled relationship definitions,
including enrichment, before a resource is published or a canonical field
addition commits. An explicit resource `queryMaxLimit` takes precedence over the
inherited value for this check. Previously the registration stages could reject
valid higher overrides or miss enriched limits above a lower resource maximum.

`include.limit` accepts a non-negative integer, `null` or `false`; omission keeps
the existing default. Zero is valid, and `null`/`false` retain their existing
unbounded-include meaning. Negative, fractional, NaN and nonnumeric values now
fail compilation. `include.orderBy` retains its array form and validates entry
syntax during compilation. Target-field resolution and database window-function
support remain query-time checks so forward resource references still work.
Query-time target caps and selection behavior are unchanged.

The deep `validateIncludeConfigurations` helper now has a named export and takes
the `schema:compiled` candidate context (`scopeName`, `scopeOptions`, `schemaInfo`),
not the former scope-added context. Normal plugin users need no call-site change.

## Enhancing an existing logger

The internal `enhanceLogger(logger, options)` utility now safely replaces methods
on the supplied logger. Its wrappers capture each original writer and receiver
at enhancement time; previously they looked up the replaced method again and
could recurse until the stack overflowed. The utility still returns the same
logger, preserves writer return values and propagates writer failures. Existing
`createEnhancedLogger` wrappers likewise retain the writers captured at creation.
Install the desired base writers before creating an enhanced logger.

## Error causes in diagnostic output

Operation failure reports now include these stable fields:

| Field | Meaning |
| --- | --- |
| `method` | Resource method, HTTP verb, or named setup/socket operation; null when unavailable |
| `scopeName` | Resolved resource name; null before resource resolution or for server-wide operations |
| `phase` | Reporting boundary, such as `writeFailure`, `httpError`, `include`, `admission`, or `redisShutdown` |
| `backend` | Knex client name, `socketio`, or `redis`; null when unavailable |
| `transactionOutcome` | Existing transaction state at reporting time: `none`, `pending`, `committed`, `rolledBack`, or `unknown` |

`phase` describes where an error is reported. It does not identify every hook
that ran before the failure. Existing nested getter, setter, include and
relationship-metadata errors retain their more specific context and causes.
Cleanup warnings may report `pending` even when the operation later commits.
Socket notification permission checks run outside a transaction and report
`none`; subscription-matching reads inside a write report its borrowed transaction
state. Setup/debug traces are informational and need not contain this envelope.

Formatted diagnostics now include native `Error.cause` and `AggregateError.errors`
properties, which JavaScript normally makes non-enumerable. Nested errors retain
their names, messages and selected stacks, including errors inside diagnostic
`details`. Primitive causes are retained. Existing depth and cycle limits apply
to these nested values, and the original errors are not modified. Consumers that
parse diagnostic objects should allow these additional fields. This does not
change HTTP error responses or the errors thrown by resource methods.

## Shared filter traces omit payloads

The shared basic-filter trace messages no longer print filter values, entire
filter objects or field definitions. They retain scope, table, field and operator
information. Filtering behavior and SQL bindings are unchanged. This is a
specific trace-output change. See [field-aware diagnostics](#field-aware-write-diagnostics)
for structured redaction and its limits.


Ordinary storage operation messages also omit query parameters, POST bodies and
PATCH attributes. Upload-completion messages omit stored URLs, and Socket.IO
subscription messages omit filters. These changes affect diagnostics only;
records, upload results and subscription acknowledgements retain their values.


Include-loader diagnostics now report ID counts rather than identifier arrays.
They also omit complete relationship/include definitions and selection lists
from the affected load messages. Query construction and returned includes are
unchanged.


## Connector error logs use route templates

Express and Fastify request-error diagnostics now use the registered route
pattern, such as `/countries/:id`, as `path`. They no longer include a raw `url`
field or put query strings and concrete resource IDs in that path metadata.
Express may omit `path` for errors that occur before a route is matched.
HTTP routing and error responses are unchanged. Error-object details are a
separate diagnostic payload and may still carry resource identifiers.

Both connectors await error diagnostics. A failing writer leaves the original
HTTP response intact and adds the logging failure to `context.cleanupErrors`
with `phase: 'logging'` and `during: 'httpError'`. Express route-registration
diagnostics also preserve the original setup rejection if logging fails.

HTTP diagnostic loggers omit structured `body` and `headers` containers,
including on errors raised before a route supplies resource metadata. Known JSON
parser failures (`type: 'entity.parse.failed'`) produce a generic diagnostic
preview with name, message, type and status. Their raw message, stack, body and
cause are omitted because parser messages can quote the request body. Express
uses this parser identifier already; the Fastify JSON parser supplies the same
identifier. The original error still reaches hooks and HTTP error mapping.

A read hook that throws `null` or `undefined` produces a generic JSON:API 500
response. Conditional PUT and positioning target reads recognize typed
not-found errors; other hook failures propagate through the transaction's
normal failure handling.

## Formatted errors are bounded previews

`formatError` and `formatErrorString` now produce bounded diagnostic previews:
50 entries per container, 256 serialized-value visits, 2,048 characters per
string, and a shared 8,192-character budget for copied text. Existing depth and
cycle handling still applies. `[Truncated]` markers identify omitted content;
these limits are not a promise of an exact byte length after JSON escaping or
pretty printing. The original error and its attached values are unchanged.

Non-object `toJSON()` results appear under `toJSONResult` rather than being
spread into character-index properties. Big integers and symbols in diagnostic
values become text, functions become markers, and object-valued error names or
messages become a non-string-text marker. These are diagnostic representations,
not changes to the errors thrown by the API or the HTTP error contract.

One-line summaries share the bounded formatter and are capped at 2,048
characters, including any truncation marker.
Short summary spelling is unchanged. Summaries inspect only message, code,
violations and fields; they do not invoke custom `toJSON()` methods.

## Enhanced logger events share a preview budget

Standard enhanced log methods now bound the complete argument list, including
message strings and additional diagnostic data. They format at most 50 supplied
arguments and use the existing shared depth/traversal/text limits for the emitted
event. Truncation is explicit; source arguments are not mutated. The internal
`formatDiagnosticValue` helper exposes that same bounded value conversion.

Validation errors now produce one structured event containing their details.
The former extra `Validation error details:` event has been removed. Logger
receiver binding, return values and exceptions still come from the original
writer. These bounds do not apply to direct calls that bypass the enhanced
logger, and bounding is not sensitive-field redaction.

The storage, positioning and file plugins use this formatter for their own
diagnostics too. Include messages report counts instead of complete path
collections. These changes preserve logger binding and query/file behavior;
they do not add a resource-field policy to every logger.

## Field-aware write diagnostics

The resource write-error logger now derives redacted field names from compiled
`outputFields`: both `hidden: true` and `normallyHidden: true` are redacted when
that metadata is available. Explicitly requesting a normally-hidden field in a
response does not make its diagnostic value visible. Caller input and thrown
errors are unchanged.

The internal enhanced logger and formatter accept `redactFields` for structured
payload keys. Matching values become `[Redacted]` before they are read. Validation
objects whose `field` is a listed name or `data.attributes.<name>` retain field
and rule metadata with a redacted message; their other payload properties are
omitted. Summaries use the same policy. Enhanced loggers snapshot the configured
field-name list at creation.

When field redaction is configured or `includeStack: false` is selected,
`formatError` inspects ordinary error properties without invoking `toJSON()`.
Custom conversion could otherwise read an excluded stack or copy a hidden value
under another key before filtering. Unrestricted diagnostics still use custom
`toJSON()` results. Nested error-envelope accessors are inspected once through the
bounded value formatter; their returned errors use ordinary property inspection.

This is structured-field redaction, not a scanner for arbitrary secret text in
messages. Early failures without compiled metadata cannot infer which application
attributes are sensitive. Custom search validators should return general
validation messages: their text can become the query error's top-level message,
where field-key redaction cannot recognize a value embedded in a sentence.

The resource-field policy applies to write reports, matched HTTP resource routes,
file cleanup, subscription admission/removal, subscription matching and
notification permission reports. It uses the resolved resource's compiled fields;
it does not guess a resource from a URL, an authentication error or a client-supplied
subscription name. Authentication and server-wide reports omit raw handshake,
credential and subscription-filter objects. Application properties deliberately
attached to an authentication error still appear as bounded diagnostics: a field
named `accessKey` there does not inherit an unrelated resource's field policy.

Buffers and other binary values are represented by type and byte length,
including uploaded-file metadata and nested errors. Identifiers, filenames,
paths, arbitrary application/driver error text and values copied under unrelated
keys are not automatically secret-free. Use general error messages, omit secrets
from custom error properties, and apply any broader retention/redaction policy in
the application-owned logger. Direct application logger calls do not pass through
the library's formatter. The built-in runtime no longer emits upstream method
arguments or plugin-option dumps.

Socket connection/disconnection diagnostics and Redis setup/shutdown diagnostics
contain throwing and rejecting writers. They cannot prevent handler installation,
subscription acknowledgement or later Redis cleanup attempts. A Redis setup
failure retains cleanup failures as secondary `AggregateError` members. The Redis
adapter is configured before attaching Socket.IO to the caller's HTTP server, so
an adapter setup failure leaves that server's listeners intact. If destruction
itself fails, startup reports the failure without waiting indefinitely for the
connection attempt that could not be cancelled.


## Opt-in stored revision migration

Resources that select `versionField` need an explicit stored string field and a
backfill of existing rows before conditional writers are enabled. Follow the
[version-field migration guide](22-version-field-migrations.md) for
ordinary and canonical storage, a tested backfill example, retry/rollback and
readiness checks. Clients submit `expectedVersion` outside record attributes;
bulk PATCH/DELETE use aligned `expectedVersions` arrays. These are revision
conditions. HTTP representation conditions use the separate contract below.

## Opt-in HTTP representation conditions

The executable client example is `examples/conditional-http-client.js` in the
repository. Import `readForConditionalUpdate`, pass the complete resource URL
(including its query), edit the returned `document`, then call `save` with a
JSON:API update document. Supply application headers and `credentials: 'include'`
when your cross-origin session requires them. Each returned object retains the
original read's ETag: after saving, read again before another edit. The example
returns the write's `Response` so the caller can handle 412 and other errors.
Run `node --test tests/http-validator-client-example.test.js` on Node 24 to
exercise it against real Express and Fastify HTTP servers.

HTTP representation conditions require no version column. They compare the
selected JSON response, including requested includes,
fieldsets, computed values and response-hook changes.

Enable it when installing either connector, before registering resources:

```js
await api.use(ExpressPlugin, { mountPath: '/api', httpValidators: true })
// Or use FastifyPlugin with the same httpValidators option.
```

The default is `false`. Successful GET/HEAD responses with a body receive a
strong ETag. Preserve the complete quoted header value and send it unchanged in
`If-Match` when updating or deleting the same resource. Use the same query string
and representation-selecting request headers for the read and write:

```js
const url = '/api/articles/42?include=author'
const selectedHeaders = { Accept: 'application/vnd.api+json' }
const current = await fetch(url, { headers: selectedHeaders })
if (!current.ok) throw new Error(`Read failed: ${current.status}`)
const etag = current.headers.get('ETag')
if (!etag) throw new Error('The selected response has no ETag')

const updated = await fetch(url, {
  method: 'PATCH',
  headers: {
    ...selectedHeaders,
    'Content-Type': 'application/vnd.api+json',
    'If-Match': etag
  },
  body: JSON.stringify({
    data: { type: 'articles', id: '42', attributes: { title: 'Revised title' } }
  })
})
if (updated.status === 412) {
  // Read again and resolve the competing change before submitting another edit.
} else if (!updated.ok) {
  throw new Error(`Update failed: ${updated.status}`)
}
```

A matching strong tag permits registered resource PUT/PATCH/DELETE. A stale tag
returns 412 with code `REST_API_PRECONDITION_FAILED`. Weak tags cannot match;
malformed headers return 422. `If-Match: *` checks visible existence only and
does not detect intervening edits. Omitting the header leaves writes
unconditional. Conditional PUT cannot create a missing resource. Collection
POST, relationship mutations and bulk routes currently reject `If-Match` with
422; use their documented direct revision conditions where supported. Normal
validation and authorization errors take precedence over comparison. A hidden
PUT target rejected by existing resource checks retains 404; a missing target
that otherwise permits PUT-create returns 412. These HTTP PUT outcomes are not
an identical hidden/missing response contract. This
option does not implement `If-None-Match` caching. Stored `expectedVersion`
conflicts remain a distinct 409 error.

For cross-origin browser clients, install `CorsPlugin` after the connector and
allow `If-Match` requests and expose `ETag` responses. These arrays replace the
defaults, so retain other headers your application needs:

```js
await api.use(CorsPlugin, {
  origin: 'https://app.example.com',
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 'Authorization', 'X-Requested-With',
    'X-HTTP-Method-Override', 'Accept', 'Origin', 'If-Match'
  ],
  exposedHeaders: ['X-Total-Count', 'X-Page-Count', 'Link', 'Location', 'ETag']
})
```

Enabling this option makes the connector serialize successful GET/HEAD bodies
once with `JSON.stringify` after response hooks and send those exact bytes.
Express JSON spacing, replacers and escaping settings, and Fastify custom JSON
serializers, do not process those pre-serialized bodies. Move required body
transformations into the resource output or transport response hook before
enabling it. Middleware that subsequently changes bytes or content encoding
must also maintain the corresponding validator. Successful PUT responses emit
no validator in this mode; fetch the selected representation again for its tag.

A strong conditional write renders a speculative GET inside its managed
serializable transaction before changing the resource. Response hooks see
`context.precondition === true` and normalized GET request metadata during that
render, then run separately for the actual write response. Keep rendering
deterministic and free of external side effects. Computed database reads must
borrow `context.transaction` and preserve the caller's authorization context.
Normalized request headers are copied; native request/reply objects and
application callbacks are still owned by the actual request. Do not use native
response methods while rendering the speculative view. Transaction conflicts
currently retain native error handling (HTTP 500), with no automatic retry.

See the [API reference](../API.md) for conditional request options and
[version-field migrations](22-version-field-migrations.md) for database preparation.
