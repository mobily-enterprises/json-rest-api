# Incremental JavaScript type checking

Run `npm run typecheck` with Node 24. It runs TypeScript with `noEmit`; runtime
files remain ESM JavaScript and require no compilation or generated output.
`npm run verify` runs this check first, so the existing library CI job runs it
after `npm ci` as well. TypeScript 5.9.3 and the Node 24 declarations are direct,
exact development dependencies. Those versions were already in the lockfile;
this change does not upgrade the dependency graph or add runtime dependencies.

The configuration uses `allowJs` with per-file `// @ts-check` opt-in. Global
`checkJs` is false so importing a dynamically typed module does not pretend its
body is covered. Strict checking and `noUncheckedIndexedAccess` apply to the
selected files. This follows TypeScript's
[JavaScript checking](https://www.typescriptlang.org/tsconfig/checkJs.html) and
[JSDoc type annotations](https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html).

## Checked implementation

The projection boundary uses `query-field-types.d.ts` for declaration,
compiled-field, callback-context and runtime-expression shapes. SQL bindings
remain unknown values, and callback database/context handles retain their
optional state. The eight negative cases in `tests/types/query-field-contracts.js`
include accidentally asynchronous callbacks: Knex builders and raw values are
thenable, so an `async` return can execute them. The supported selector type
returns an expression synchronously. Runtime failure handling still awaits
and reports rejected results from unchecked JavaScript callers.

| File | Checked responsibility |
| --- | --- |
| `plugins/core/lib/querying/knex-query-helpers-base.js` | Unexecuted SELECT construction, wildcard fallback and nullable-alias translation |
| `plugins/core/lib/querying-writing/knex-field-helpers.js` | Sparse/default field selection, computed/virtual dependencies, backing fields and unexecuted query application |
| `plugins/core/lib/querying-writing/query-field-helpers.js` | Projection compilation, callback context, SQL expression retention and runtime bindings |
| `lib/enhanced-logger.js` | Optional writers, bounded/redacted argument preparation, utility receivers and in-place method replacement |
| `lib/error-formatter.js` | Unknown property reads, recursive bounded previews, error metadata and summaries |
| `plugins/core/lib/querying-writing/default-data-helpers.js` | Missing-storage placeholders conform to the read/write request envelopes and never resolve |
| `lib/error-context.js` | Transaction participation, in-flight work, ownership, completion hooks/finalizers and error wrapping |
| `lib/knex-transaction.js` | Owned transaction creation, lease-release callbacks, completion outcomes and secondary cleanup errors |
| `plugins/core/connectors/lib/http-validators.js` | Serialized-byte hashing, unknown header input validation and strong-comparison condition shapes |
| `plugins/core/lib/storage/storage-adapter.js` | Ordinary/canonical adapter construction and lookup, column/value translation, scoped builders and selection helpers |
| `plugins/core/lib/storage/storage-mapping.js` | Ordinary naming/mapping, serialization and row conversion |
| `plugins/core/lib/storage/canonical-storage-mapping.js` | Canonical slots, logical IDs, attribute/linkage conversion and value extraction |
| `plugins/core/lib/storage/ordinary-data-helpers.js` | Ordinary CRUD, minimal reads, collection reads, sort descriptors and deferred relationship-ID queries |
| `plugins/core/lib/storage/canonical-data-helpers.js` | Canonical CRUD, minimal reads, collection reads and sort descriptors |
| `plugins/core/lib/querying/knex-json-api-transformers-querying.js` | Ordinary row conversion and complete single/collection JSON:API response assembly |
| `plugins/core/lib/querying/storage-adapter-utils.js` | Hook-local adapter lookup, alias selection and value translation |
| `plugins/core/lib/querying/query-constraint.js` | Mandatory resource membership, translated equality values and unexecuted ID subqueries |
| `plugins/core/lib/querying/query-builder-utils.js` | Temporary filtering state, builder replacement/restoration and wrapped async return values |
| `plugins/core/rest-api-plugin-methods/apply-query-filters.js` | Filtering permission context, adapter restoration and deferred hooks |
| `plugins/core/lib/querying/sort-helpers.js` | Unknown sort input narrowed to stable string entries and parsed direction literals |
| `plugins/core/lib/querying-writing/resource-id-normalization.js` | Unknown ID input, synchronous configured normalizers, required/optional string results and referenced-resource lookup |
| `plugins/core/lib/querying-writing/response-options.js` | Unknown input/default validation into public format/returning unions and removed-option checks on narrowed objects |
| `plugins/core/lib/querying-writing/database-capabilities.js` | Version observations, capability literals, optional warning sinks and existing insert-returning forms |

`field-selection-types.d.ts` composes the existing storage and projection types
for the selection stage. Requested fieldsets retain their readonly possibility;
selection arrays built by the helper are mutable. The query result wrapper
contains its unexecuted builder rather than becoming thenable itself. Seven
negative cases in `tests/types/field-selection-contracts.js` check these shapes.
The shared `buildQuerySelection` body is also checked; five negative cases in
`tests/types/query-selection-contracts.js` cover builders, fields, translator
results and nullable aliases. Its translator can return null/undefined to use
the existing fallback. The `getFieldDependencyClosure` signature describes
the values consumed here, while its implementation file remains unchecked.
The column translator accepts the actual null alias used without table prefixing.
Explicit aliases in this internal SQL helper preserve raw expressions and their
bindings. A one-entry translated expression map can be renamed; empty or
multi-entry maps reject because one output alias cannot identify their result.
This does not add SQL alias syntax to public sparse fieldsets.

`storage-types.d.ts` describes these existing boundaries. It does not introduce
a runtime interface, metadata copy or adapter implementation. Both adapter
factories are checked against `StorageAdapter`, including the returned method
implementations. The types describe the metadata these modules consume; they
are not complete public resource declarations or a static validator for every
schema extension.

The database normalizer's exported options also have JSDoc so calls from checked
storage modules can be validated. Its implementation body remains dynamically
typed. The storage operation bodies now live in the checked helper modules above;
the two Knex plugin installers retain setup and schema-registration code outside
that checked subset. The later storage and lifecycle sections record the current
implementation coverage. Imported JavaScript can supply inferred or annotated
signatures without its body being checked; this is not whole-repository checking.

## Values and ownership

Response-option resolution accepts unknown input and fallback configuration,
including omitted values, and returns the existing public `ResourceFormat` or
`WriteReturning` union after validation. It does not assert that application
configuration was valid before the helper ran. Removed-option validation accepts
an object and returns no replacement value. Six negative fixtures in
`tests/types/response-option-contracts.js` check that callers cannot confuse the
two unions, assume a single format or boolean result, or treat unchecked/null
input and a void validation result as option objects.

ID normalization reuses the public `RestApiPluginOptions.normalizeId` callback
type. Its options describe only the scope/variable properties this helper reads;
they do not duplicate a full API or compiled-resource interface. Optional IDs
return `string | null`; required-ID helpers return a string or throw. Inputs
remain `unknown`, including identifiers supplied to custom normalizers.
Relationship normalization also returns `unknown`: it passes malformed shapes
through to later validation, so it cannot promise a valid resource identifier
or relationship document. The object-property assertion after its object guard
keeps every property value unknown; it does not assert field validation.

`tests/types/resource-id-contracts.js` has eight negative fixtures covering an
unnarrowed optional result, async/object-returning/narrow-input callbacks,
invalid scope names/configuration and unvalidated relationship results. Runtime
ID tests separately verify normalization, custom IDs and relationship behavior
in both storage modes.

The HTTP validator helper accepts unknown header input and returns an optional,
discriminated condition. A wildcard carries no entity tags; a list carries tags
with an explicit boolean weakness marker and opaque string value. Consumers see
read-only tag/condition fields. Hashing requires a serialized string or Buffer
and textual representation metadata. Comparison requires an explicit existence
flag. These annotations check the actual helper body; they do not freeze runtime
objects or declare the whole connector/API surface statically verified.

`tests/types/http-validator-contracts.js` includes seven negative fixtures for
object hashing, invalid metadata, missing existence, mixed wildcard/tags,
invalid weakness markers, unnarrowed optional results and tag mutation. The 31
runtime validator/method-exclusion tests pass alongside these compiler checks.
The package now has a public declaration entry point, described below. Automatic
plugin/resource typing and consumer acceptance under A9-09 remain open; the
concurrency-specific public contract under B3-11 is verified.

Rows and translated values carry `unknown`. Custom serializers and native
drivers determine their actual representations; declaring those outputs as
strings or as validated public JSON would be false. Checked callers narrow
values before string/numeric operations or restricted driver bindings. Schema
validation, storage conversion and runtime serializer validation still apply.

`buildBaseQuery({ transaction })` borrows the supplied database handle. Existing
internal callers sometimes pass a Knex instance through that option; both it
and a real Knex transaction are supported. The adapter exposes neither commit
nor rollback. It supplies physical resource scoping, while authorization remains
the responsibility of the query/lifecycle callers.

The serializer's optional `then` probe asserts only that the property can hold
an unknown value, then checks its actual type. It does not assert a successful
conversion. Direct property access preserves thenables supplied through a
Proxy's getter even when the proxy does not report the property through `has`.

## Contract fixtures and expansion

`tests/types/storage-adapter-contracts.js` is compiled, never executed. Positive
calls cover builders, mappings, selections, hook utilities, nullable rows and
guarded driver values. Thirteen `@ts-expect-error` cases require rejection of
incorrect field/row/selection shapes, missing methods, incomplete or unresolved
database handles, transaction ownership options and unguarded unknown values.
An unexpectedly accepted call makes `tsc` fail with an unused directive.

To expand checking, add the implementation to `tsconfig.json` and opt it in with
`// @ts-check`, annotate the existing functions, and extend the contract fixture.
Keep absent dictionary entries explicit and keep opaque values `unknown` until
validated. Do not replace missing contracts with `any`, broad suppressions or
assertions that claim validation happened. Runtime defects found while annotating
need runtime regressions as well; compiler errors alone do not prove behavior.

## Transaction lease boundary

`lib/knex-transaction.js` now opts into strict checking. Its factory returns an
actual Knex transaction, and lease completion accepts a resolved transaction or
an absent handle during failed preparation. A plain Knex database, promise or
object containing only a completion promise does not satisfy that boundary.
The outcome union matches the existing runtime vocabulary: `none`, `pending`,
`committed`, `rolledBack`, and `unknown`. Cleanup errors retain unknown thrown
values rather than pretending all failures are Error instances.

The Knex client declarations expose native connections dynamically. This helper
annotates only the existing disposal marker it uses; it does not claim to check
the driver's connection implementation. Transaction ownership itself is enforced
by the runtime's private lease map, not by structural types. The orchestration
in `error-context.js` is also checked as described below.

`tests/types/transaction-lease-contracts.js` adds five negative calls and valid
completion/diagnostic examples. Removing the five expected-error directives in
a temporary fixture produced exactly five compiler errors; the probe was removed.
Both storage modes passed their twelve connection-release/completion cases, and
the changed implementation and fixture passed lint. This expands A6/A9 coverage
without completing their remaining lifecycle, query, capability or public types.

## Transaction orchestration

`transaction-types.d.ts` describes only the fields and state already used by
`error-context.js`: owner/participant contexts, in-flight completion promises,
completion hooks, finalizers and lifecycle phases. It creates no runtime hierarchy
or metadata copy. Resource validation, enrichment and storage-specific context
fields remain outside this checked subset. Generic wrappers retain each handler's
request and result types; the callback transaction helper preserves its result.

The compiler library is ES2024 to describe `Promise.withResolvers`, supported by
the required Node 24 runtime. The no-emit target remains ES2023. The small internal
`hooked-api-error.d.ts` describes the installed dependency's `HookedApiError`
constructor and code property; it is not a public declaration of the dependency's
API/plugin machinery. The validation-error constructor now annotates its existing
field and violation input, with optional violation rules.

Knex's commit return type does not describe PostgreSQL's completion response.
The checked code treats that result as unknown and inspects the response/command
shape before recognizing ROLLBACK. Thrown values likewise stay unknown. Error
formatting probes their message once and preserves the original cause even when
a getter fails. The lease map and orchestration maps remain runtime authorities;
structural types cannot establish that a handle was actually registered.

Nine negative fixtures verify invalid database ownership, transaction factories,
outcomes, hooks/finalizers, missing request fields, incorrect callback results,
and invalid participant/state shapes. A temporary unsuppressed fixture produced
exactly nine compiler errors. Remaining A9 work includes resource-stage contexts,
query/result/capability contracts, diagnostics and public consumer declarations.

## Mandatory membership boundary

`MandatoryQueryConstraint` names the existing symbol-keyed context value. Its
resource name is required; logical equality values and an unexecuted ID builder
are optional and may be combined. `applyQueryConstraint` is checked against the
existing storage adapter and builder types. It does not own either transaction
completion or resource authorization. It leaves other resource scopes alone.

Translated serializer/driver values remain unknown. The equality predicate uses
Knex's field/value-map form rather than asserting those outputs are strings or
numbers. Direct database tests cover mapped columns, serialization, false/zero,
null, ID subqueries, empty membership, retained predicates and cloned counts.

`tests/types/query-constraint-contracts.js` adds six negative calls: a missing
resource, executed rows or a promise in place of a builder, an array of values,
a non-string scope, and an incomplete adapter. Removing their expected-error
directives produced exactly six compiler errors. The producer methods and wider
query orchestration remain dynamically checked; this slice does not complete
the broader A6-02/A9 typing requirements.

`buildBaseQuery` also accepts a string `tableAlias`. The checked canonical adapter
qualifies both tenant and resource predicates by that alias; the ordinary
adapter uses the same native Knex alias form. The added negative-call fixture
rejects non-string aliases. This option replaces the query proxy's duplicated
base-query construction and does not confer transaction ownership.

## Stable sort boundary

`normalizeStableSort` accepts unknown input because it deliberately filters
non-string entries. Its result is a string array and its optional identifier
field is a string. `parseSortEntry` consumes a normalized string and preserves
the distinct logical (`asc`/`desc`) and SQL (`ASC`/`DESC`) direction unions.
These annotations leave normalization and parsing behavior unchanged.

`tests/types/sort-contracts.js` checks valid normalization/parsing composition
and four rejected calls: numeric identifiers, numeric parser input, numeric
normalized entries and mismatched direction spelling. An unsuppressed temporary
fixture produced exactly those four diagnostics and was removed. The shared
sort-field suite reports 35 passes in each storage mode on Node 24. Wider query
descriptors and cursor/schema orchestration are still outside this checked body;
A6-02 and A9's broader type requirements remain open.

## Adapter lookup lifetime

`createStorageAdapterLookup` is checked in the existing storage adapter module.
Its synchronous resolver supplies the current resource's compiled-schema/adapter
view, or an absent resource. Each lookup owns its resource-name/schema-identity
map and returns an adapter or null. No global cache or parallel schema is added.

`tests/types/adapter-lookup-contracts.js` rejects numeric names, asynchronous
resolvers, incomplete metadata and unchecked nullable results. An unsuppressed
probe produced exactly four intended diagnostics and was removed. Configuration
mutation policy and wider stage types remain under A5/A9.

## Query filtering context

`QueryFilteringState` describes the existing hook state. Entry to
`withQueryFilteringContext` requires a native builder; a hook may replace it,
clear it or remove the temporary state. The result is a promise of `{ query }`,
so awaiting the helper does not assimilate the builder's `then` method and run
SQL. The filter callback is deferred. The permission-checking resource method
also checks its context, adapter and hook signatures. An absent query purpose
uses an empty string for the permission-purpose membership check.

The type fixture rejects materialized rows as builders, missing entry builders,
already-started promises as callbacks and treating the wrapped result as rows.
The legacy unwrapping helper accepts and returns `unknown`: unwrapping an object
does not establish that its value is a valid Knex builder. Dynamic callers are
not thereby statically verified. Seven existing runtime checks verify deferred
execution and restoration through replacement, clearing, nesting and failures.
Broader data-helper and lifecycle typing remains open under A6-02/A9.

## Declared write-helper boundary

The ordinary and canonical plugins annotate `dataExists`, `dataPost`, `dataPut`,
`dataPatch` and `dataDelete` with backend-specific contracts from
`storage-types.d.ts`. Their implementation bodies remain unchecked. The
`data-write-contracts.js` fixture checks required DB/context inputs, the explicit
PUT branch, unknown POST results and the different ordinary/canonical write
results. It does not establish backend implementation conformance. See the
[write-helper inventory](storage-boundaries.md#write-helper-signatures).

## Negative-contract acceptance: A9-06

The nine fixtures in `tests/types` cover adapter arguments and construction,
resource lookup, mandatory membership, sort values, transaction leases and
participation, filtering state, and data read/write signatures. They include
positive calls as well as negative cases. The read cases distinguish nullable
single resources, batch arrays and documents; write cases distinguish the PUT
branch and backend results. Checked transaction and filtering helpers reject
unresolved handles, invalid outcomes and eager promises in deferred positions.

The Node 24 acceptance audit removed only `@ts-expect-error` comments in a
compiler-host memory view, preserving line numbers and repository source. It
found **56 diagnostics at 56 expected sites**, with no missing sites or errors
elsewhere. Each diagnostic was reviewed against its fixture's intended failure.
Normal `npm run typecheck` passes with the expectations retained. This confirms
the fixtures detect the intended errors; it does not make unchecked plugin
bodies or unpublished consumer declarations statically verified. A9-06 is
complete; A9-02–05/A9-09 and A6-02 retain their broader requirements.

## Public package entry point

`index.d.ts` and the manifest's `types` field expose all 27 runtime exports plus
the declaration components below. Import values and types from `json-rest-api`;
`types/` is declaration organization, not a new runtime module tree. Node and
Knex declarations are required for this selected type surface. Fastify and
Express are not imported by the declaration graph.

`npm run test:public-types` packs the working library into a temporary directory,
verifies the exact runtime/declaration and selected documentation file set,
extracts it as an installed package, and compiles an independent strict NodeNext
consumer without `allowJs` or `skipLibCheck`. It checks exact runtime/declaration
export agreement and ten negative package-import cases, matching each rejection
to its expected source line. Dependency files are
shared with this checkout; the library files come from the tarball. This checks
packaging and public resolution, not a clean dependency installation or migrated
jskit-ai/vibe64 workflows. `npm run verify` includes this gate.

The manifest's `files` allowlist includes JavaScript and declaration files under
`lib/` and `plugins/`, declaration files under `types/`, both root entries, the
license, README, API reference, quickstart and Markdown guides. No exports map or
runtime path restriction is introduced by this packaging change. Tests, scripts,
agent instructions, development ledgers and parked patches are excluded. New
runtime asset kinds need an intentional allowlist and verification update.

The managed-transaction and transaction-outcome contracts now live under
`docs/GUIDE/`, so their API-reference and migration-guide links also resolve
inside the tarball. Verification ledgers and other repository evidence remain
outside the published file set.

`npm run test:clean-package` separately installs the actual tarball into a fresh
temporary consumer using npm, with development and optional dependencies omitted.
It verifies root and selected deep imports without optional peers, and checks
that installing the Express plugin reports its absent dependency. It then
installs Knex and better-sqlite3 from the declared development ranges and runs
create/read/update/delete flows in ordinary and canonical storage. Installed
dependency versions and the artifact hash are printed; no checkout dependencies
are symlinked and the temporary consumer is removed on exit. This network/native
installation check is explicit, outside the usual full gate. It does not compile
types or execute the paused real-consumer migrations.

The upstream `hooked-api` installation/injection API remains dynamically typed.
Plugin values expose their identities and an opaque installer owned by that
framework. Use the exported option types with `satisfies` and explicitly type
resource references with the resource-method interfaces. Automatic inference
from plugin installation/resource schemas, remaining option surfaces, deep-import
declarations and actual consumer validation remain unfinished under A9-09. B3-11
has separate evidence for its concurrency types, examples and runtime acceptance.

## Public error declarations

`types/errors.d.ts` describes all nine exported error classes and three error
code constants, re-exported through the package declaration entry point.
Upstream API integration and consumer validation remain under A9-09.

`tests/types/public-errors.ts` checks construction, resource-error inheritance
and serialized output. Seven negative cases reject missing/invalid transaction
outcomes, attempts to mutate the runtime read-only outcome, unsafe access to
unknown causes/forwarded fields, invalid IDs and incomplete violations. Removing
only the expectation comments in a compiler-host memory view produces exactly
those seven diagnostics. The standard typecheck now includes TypeScript fixtures
as well as existing checked JavaScript fixtures; no runtime transpilation is added.

## Public representation declaration draft

`types/representations.d.ts` describes identifiers, JSON:API resource documents,
plain records and collection envelopes. Conditional result types distinguish
`format` and `returning`, including the `{ type, id }` minimal result in plain
mode and its JSON:API envelope. Input identifiers accept string/number while
normalized output identifiers are strings. Declared resource fields are partial
because sparse fieldsets can omit attributes and relationships.

These types are exported from the package root. The corresponding
TypeScript fixture checks positive examples and seven negative contracts. Its
compiler-host audit produces exactly the expected seven diagnostics when only
those expectation comments are removed in memory. Method inputs, configured
defaults and plugin/resource inference still require explicit consumer types.

## Resource CRUD declaration draft

`types/resource-methods.d.ts` adds get/query/post/put/patch/delete signatures.
`ResourceCoreMethods` separates returned fields, writable input fields, resource
type, configured format/return defaults and application context. Explicit call
options override those defaults. Input shape follows the selected format;
format is not inferred from an input record to silently accept a mismatched
document. PUT/PATCH require a target ID in parameters or the input record.

The draft preserves selection-only GET options, query pagination mode exclusion,
opaque string revision arguments, borrowed Knex transactions and removed-option
rejection. Required schema fields, token contents and resource versioning
configuration still require runtime validation. This is not yet the complete
automatically inferred resource surface: plugin installation and schema-driven
inference remain open. `tests/types/public-resource-methods.ts` passes positive
examples and ten audited negative checks, including custom application context
without requiring an index signature.

## Bulk declaration draft

`types/bulk-methods.d.ts` separates bulk responses from single writes:
`returning: 'none'` retains batch metadata, JSON:API results contain resource
objects, and deletion reports input IDs in `meta.deleted`. Bulk POST accepts
the implementation's resource/document forms in JSON:API mode; bulk PATCH
operation data is a resource object. Revision arrays belong only to updates
and deletes. Array length and token validation remain runtime responsibilities.

Configured atomic defaults are explicit in `BulkResourceMethods`. A caller
transaction requires atomic mode; configured non-atomic resources must select
`atomic: true` when borrowing one. The draft omits query selection options that
the bulk implementation does not forward. Eight negative fixtures cover these
boundaries and response shapes. These declarations are exported from the root;
automatic resource integration remains open.

## Relationship declaration draft

`types/relationship-methods.d.ts` describes linkage and related-resource reads,
plus PATCH/POST/DELETE relationship methods. A type-only relationship map uses
`ToOneRelationship<Fields, Type>` or `ToManyRelationship<Fields, Type>`; it is
not additional runtime configuration. Known names, target types and cardinality
then determine accepted linkage and returned resource shapes. Linkage reads
retain a JSON:API document even with `format: 'plain'`. Plain to-one related
reads can return null; to-many reads retain collection envelopes.

The default dynamic map also accepts runtime-configured relationships, with
broader result types. Eight negative fixtures verify unknown names, to-one
append/delete rejection, linkage cardinality/target types, pagination and nullable
reads. A positive dynamic case exposed NoInfer blocking conditional distribution;
moving the guard outside the resolved query/input type fixed that case without
weakening the declared relationship checks. They are exported from the package
root; automatic plugin/resource integration is still open.

## Core, HTTP and CORS option drafts

`types/plugin-options.d.ts` describes the core defaults and synchronous ID
normalizer, common connector settings including `httpValidators`, and CORS
origin/header options. CORS origin decisions may be asynchronous. These shared
types do not import optional HTTP frameworks; framework-specific installation,
file parser and middleware contracts remain unfinished.

The normalizer review corrected an earlier declaration omission: direct method
ID parameters accept BigInt through `DirectResourceId`, while record/relationship
payload IDs use `InputResourceId` (string/number). Output resource IDs remain
strings. Bulk deletion metadata preserves the supplied IDs, so its type includes
BigInt for direct calls. Convert BigInt before constructing HTTP JSON payloads.
Seven negative option/ID fixtures reject wrong booleans, removed configuration,
asynchronous or nonscalar ID normalization, invalid CORS decisions/header shapes
and BigInt linkage payloads. Core, relationship and bulk positive fixtures cover
the supported direct BigInt paths. These types are exported from the root.

## Managed transaction declaration draft

`types/transactions.d.ts` defines `TransactionMethods` and a type-only managed
transaction marker. Runtime ownership remains in the existing private registry;
no symbol or wrapper is added to transaction objects. The callback result is
preserved for synchronous and asynchronous callbacks. The handle retains Knex
SQL operations while commit, rollback and nested transaction/savepoint calls are
unavailable through the public managed type, matching the ownership contract.

Core, relationship and bulk write declarations now require a managed handle;
read declarations continue accepting raw Knex transactions. Earlier drafts that
allowed any Knex transaction for writes were too broad. Positive fixtures cover
reads with raw handles and composed managed writes/raw SQL. Eight negative
fixtures verify rejected unmanaged writes, manual completion/savepoints and the
removed options-object transaction signature. Package imports now pass; actual
consumer API integration remains open.

## Storage and auxiliary plugin option drafts

`plugin-options.d.ts` now describes ordinary/canonical Knex plugin options,
bulk defaults and label preferences. Both storage plugins take an existing Knex
instance; canonical storage optionally selects a tenant. The declaration does
not substitute a database connection configuration for that instance. Bulk
atomic mode is boolean, limits are numeric and label preferences are ordered
field-name arrays. Runtime validation still owns numeric bounds and database
configuration validity. Six negative fixtures verify these argument shapes.
These root-exported option types still await coupling to plugin installation.

## File storage declaration draft

`types/file-storage.d.ts` describes both exported storage classes and an adapter
interface. Local upload input requires contents or a source path. Contents use
Node's filesystem writer input type, including byte buffers and iterable/streamed
data. Metadata-only filename helpers remain usable separately. Custom naming
requires a generator returning a basename, synchronously or asynchronously.
Adapter methods can also return synchronous values because the file plugin
awaits their results.

The S3 class is explicitly the existing mock adapter: its constructor requires a
bucket and permits only the supported mock mode. This does not add an AWS SDK or
production S3 support. Six negative fixtures cover missing custom generators,
invalid generator/content shapes, missing local content, missing bucket and
unsupported real S3 mode. The classes and associated types are exported from the
package root, not runtime modules under `types/`.

## File detector declaration draft

`types/file-detectors.d.ts` describes the detector registry, parsed fields and
one-file-per-field results, and Express parser factories/options. Detected files
carry MIME type and numeric byte size for acceptance and size checks. Detection
and parsing can be synchronous or asynchronous; parsing can return no result.
The detector context is optional because the Express wrapper invokes custom
parsers with request parameters alone. Parser-specific peer options remain an
open record, while built-in parser names are limited to busboy and formidable.

Six negative fixtures cover invalid detection results, file metadata, array
results, parser names and incomplete factories. These root-exported declarations
still await automatic plugin integration and real consumer acceptance.

## Fastify option declaration draft

`types/fastify-options.d.ts` requires an existing server with the route, parser,
registration and hook capabilities used by the connector. It deliberately does
not import the optional Fastify package or redeclare its request/reply APIs.
The host's callable members are opaque capability checks, not signatures for
calling Fastify methods. Use `satisfies FastifyPluginOptions` to retain an
instance's own inferred type, or supply that type as the option's generic.

Compiler fixtures accept actual HTTP/1 and HTTP/2 Fastify instances, retain
normal route registration through inferred and explicit instance types, and
reject missing/configuration-only/incomplete hosts, Express-only body-limit
configuration and nonboolean validator settings. A separate declaration graph
check verifies that this component does not import Fastify. Automatic plugin
installation integration still remains open.

## Row-policy declaration draft

`types/row-policy.d.ts` describes named and inline policies, installation options,
callback parameters and registry inspection. It reuses the checked storage
adapter/query types. Policies must return an explicit boolean, synchronously or
asynchronously; returning a query builder or omitting the decision is rejected.
Application context and API types are generic. Optional hook-local database,
table and adapter fields remain optional in the declaration.

The shared column helper's annotation now accepts a null alias, matching its
existing documented unqualified-column behavior. Positive fixtures exercise that
helper directly and the public policy callback. Translated values remain
`unknown`, matching arbitrary custom serializers; the typed fixture narrows its
serialized owner ID before passing it to Knex. Five negative fixtures cover
policy decisions, registry/resource configuration and invalid aliases. Public
resource/plugin integration remains open.

## Autofilter declaration draft

`types/autofilter.d.ts` describes resolver callbacks, named/inline field filters,
array/object presets, resource configuration and registry inspection. It reuses
the existing storage field definition. Both `resolve` and `resolver` follow the
current runtime contract, including nullish fallback from `resolve` to
`resolver`. Required filters and missing resolver/preset names are still checked
at runtime against the resource schema and installed registry.

Resolver results remain unknown because field serializers determine their value
domain; synchronous, asynchronous, null and undefined results are accepted.
Application context/API parameters are generic; dynamically supplied framework
helpers, scopes, variables and logging remain unknown at this draft boundary.
Six negative fixtures cover missing field/resolver entries, nonfunction registry
entries, malformed presets/resources and nonboolean required flags. These are
root-exported declaration components; automatic plugin/resource integration and
consumer acceptance remain open, so no complete public typing item is claimed.

## Checked database capabilities

The existing capability module now opts into strict checking. Shared internal
interfaces describe database observations, optional diagnostic sinks, insert
result modes, schema alteration/ownership modes and native/text temporal limits.
The existing frozen serialization and relationship constants are checked against
the shared interfaces; there is no duplicate runtime capability registry. The
declaration graph does not depend on consumers enabling JavaScript checking.

Version fields remain unknown until the existing string check. Capability
returns retain literal unions, and temporal fractional precision stays nullable.
Seven negative fixtures reject configuration objects in place of initialized
Knex instances, invalid warning sinks/versions, assumed transaction-only schema
changes, unchecked nullable precision, mutation of frozen cardinalities and
numeric returning expressions.

The existing insert helper has one local signature assertion for Knex's omitted
aliased-RETURNING overload: its string/raw-expression dictionary is already used
by the ordinary plugin and covered by native generated/explicit-ID checks. The
assertion describes that verified call form and preserves its receiver; it does
not change Knex's declarations globally or assert a valid returned ID. Knex's own promise/result inference can still widen unknown results, so this
work does not claim static validation of arbitrary driver responses. Existing
runtime result validation and the broader storage/lifecycle checking work remain
necessary.

## Relationship and auxiliary storage helpers

Both plugins now annotate their deferred relationship query and transaction
factory assignments; canonical storage also annotates its count and five link
helpers. `data-relationship-contracts.js` adds eight negative cases at these
boundaries. The [storage-boundary acceptance map](storage-boundaries.md#storage-boundary-declaration-acceptance)
records exact inputs, results, ownership and the distinction between declared
caller contracts and still-unchecked plugin bodies. These are existing internal
helpers, not new public mini-ORM methods or automatically inferred plugin APIs.

## Checked relationship contract helpers

`relationship-contracts.js` now checks its four existing helper bodies. It
reuses `StorageFieldDefinition` for compiled relationship metadata, preserving
caller-specific definition fields through generic lookup instead of adding a
second metadata hierarchy. Lookup and cardinality results remain nullable.
The cardinality-map key assertion follows the existing own-property check; no
unknown key is admitted by the annotation.

The canonical mapper supplies unknown stored type/ID values and may lack a
diagnostic resource name. The linkage helper accepts that actual input boundary,
rejects non-string target names at the existing declaration-membership check,
and returns a nullable string type/ID pair. A numeric type cannot become JSON:API
linkage even if malformed metadata repeats the same number. Null/undefined
absence and numeric-zero or BigInt IDs retain their prior behavior.

`tests/types/relationship-contracts.js` has seven expected-error checks for
nullable results, declared target/name shapes, lookup keys, cardinality results
and validation's void return. Positive cases retain unknown stored input and
caller-specific metadata. This covers these helper bodies and their already
checked canonical caller, not all query/serializer/schema compilation bodies.

## Checked field selection and visibility helpers

All eight `field-utils.js` helpers now use strict checking. Field metadata reuses
`StorageFieldDefinition`; validated fieldsets accept strings or readonly string
arrays, with null/undefined absence reflected in the return types. Foreign-key
collection requires string backing-field names. Declaration-map validation
continues to accept unknown input and reject invalid map shapes at runtime.

Response-filter overloads distinguish JSON:API documents from plain records,
which require an explicit resource type. Plain fields named `data` and
`attributes` remain ordinary values. The implementation narrows the record view
after the representation branch; it does not translate between formats.
Attribute/relationship selection uses a structural view of the two member maps
because it filters keys without interpreting or replacing their values. Tests
preserve relationship-object identity and the existing member-map replacement
behavior. Visibility filtering returns unknown attribute values, not assumed
scalars or a promise that every submitted field survived.

Eleven negative fixtures check nullable fieldsets, invalid keys/metadata, required
plain-mode resource identity, document versus record inputs and non-returning
selection. Three direct behavior checks accompany the existing shared fieldset,
output-definition, label, structured-query and schema-input suites. A null
primary document with a literal `undefined` fieldset key already worked before
the explicit narrowing guard: `Map` distinguishes missing type from that string.
The new test records this behavior; it is not a defect correction.

## Checked ordinary resource conversion

The body of `querying-writing/knex-json-api-transformers.js` now checks its
existing belongs-to converter against shared storage fields and JSON:API
resource/linkage types. `ResourceConversionSchema` extends the existing storage
schema view with read-only foreign-key membership and polymorphic relationship
metadata; it creates no new runtime schema. Stored values remain unknown, while
resource and linkage IDs are strings. Absent rows produce null.

The base `toJsonApiRecord` has declared overloads distinguishing present from
nullable rows. At this earlier checkpoint its body and the complete query
response assembler were unchecked; both are checked in the storage implementation
checkpoint below.
The wrapper uses a typed relationship map without changing its conversion
algorithm. Seven negative type fixtures exercise input metadata, aliases,
resource names, row objects, read-only membership and nullable results.

Direct runtime cases verify physical ID/name/foreign-key mapping, zero and
BigInt linkage IDs, row preservation and null linkage. The initial unit fixture
incorrectly made the logical field name the physical `idProperty`; correcting
the fixture to the compiled-schema convention made both cases pass. No runtime
ID-mapping defect is claimed. Existing output-definition, ID, belongs-to and
include-error suites provide integration coverage for this focused batch.

## Checked enhanced logger

`lib/logger-types.d.ts` describes optional log levels and unknown writer results,
plus redaction options and a compiled output-field view reusing storage field
definitions. The enhanced logger checks its body against these contracts.
`logError` and `logValidationError` require a receiver with an error writer;
warning-only loggers remain usable for their supplied level. Generic input
overloads accept loggers with other properties, including `console`, without
claiming that all prototype methods are copied to the wrapper. In-place
enhancement preserves the original object's type and identity.

Eight negative type fixtures reject missing error writers, assumed promise
results, non-callable levels, invalid redaction/visibility metadata, unsupported
wrapper depth configuration, scalar convenience metadata and unchecked nullable
formatting results. Positive fixtures accept asynchronous writers, readonly
redaction names, extra logger properties and unknown thrown values.

The formatter's `formatError`/summary declarations accept unknown thrown
values and optional formatting options; `formatError` returns nullable diagnostic
properties. The subsequent formatter batch below also checks its implementation
and general diagnostic serializer. Wrapper validation-detail reads use the
existing guarded property reader. No whole-logging-system type coverage is claimed.
Runtime checks retain sync/async writer completion, redaction, bounded payloads,
error identity, in-place wrapping and rejection of a non-writable writer.

## Checked diagnostic formatter

The formatter now checks its implementation, using a recursive `DiagnosticValue`
union for primitive previews, arrays and object maps. Undefined remains possible
because arbitrary diagnostics can be absent; a diagnostic preview is not a
resource JSON:API value. A non-null object error has a non-null formatted map,
while arbitrary thrown input retains the existing nullable return contract.
Custom error JSON can change metadata value types, including `message`.

Guarded property reads accept unknown input and string/numeric keys. Reflective
reads box primitives and preserve null/undefined absence. Summaries use the
existing guarded reader and narrow arrays before traversing violations/fields.
Text handling explicitly classifies primitives without assuming unknown values
are strings. Existing entry, depth, node and text budgets are unchanged.

The logger boxes formatted metadata before spreading it, preserving ordinary
spread behavior without asserting that arbitrary diagnostics are dictionaries.
It checks formatted argument arrays and retains a non-array diagnostic as one
argument. Twelve negative fixtures now cover the logger/formatter boundary,
including unchecked metadata properties, unknown reads and invalid depth types.
No blanket `any` annotation or disabled-check directive was introduced.

## Missing-storage helper contracts

The eight default helpers now satisfy the existing read/write helper contracts
using the real single request-envelope convention. The earlier unused
`(scope, deps)` parameters did not describe the actual callers. Each body still
rejects with its existing missing-storage message before inspecting caller data.
`@satisfies` preserves the inferred `Promise<never>` result while checking
compatibility with both ordinary and canonical helper interfaces.

Four negative fixtures reject the old positional call, absent scope identity,
unprepared write context and an assumed successful placeholder result. Positive
assignments verify both storage-mode interfaces. Eight runtime cases prove that
each placeholder rejects without invoking caller-data getters. This is not a
complete custom-backend interface: transaction/query integration and installed
adapter behavior retain their separate contracts and verification.


## Resource lifecycle implementation checks

Every JavaScript implementation in `plugins/core/rest-api-plugin-methods/` now
opts into `@ts-check`: POST, PUT, PATCH, DELETE, GET, QUERY, the five relationship
operations, common write/return/visibility helpers, attribute and include
enrichment, permission/filter dispatch, route notification and release. The
wildcard entries in `tsconfig.json` include their bodies and the local
`lifecycle-types.d.ts`; these are not declaration-only acceptance fixtures.

The local types describe existing mutable working state. Method entry accepts an
empty caller context, and ordinary CRUD/query parameters do not require unrelated
relationship fields. Existing initialization produces narrow resource/read/
relationship views; write setup returns its initialized processing context.
`ProcessingContext` keeps the document contents unknown before request validation. Validated write helpers receive
the document shape, while attribute values, custom context properties, computed
values and setter results remain unknown. Single-resource and collection
contexts have distinct result shapes. The context retains the existing SQL
handle, transaction fields and mutable attribute bags; no runtime context class,
copy or new hook protocol was introduced. Storage calls reuse the checked
`DataWriteHelpers` and `CanonicalDataReadHelpers` contracts instead of declaring
another helper protocol. This also exposed an incorrect caller requirement for
`returnMeta`: the storage query implementation initializes that field itself.

Each helper requires the fields established by its working stage; it does not
require write-only fields on read or relationship operations. Entry declarations
do not claim that caller state is already initialized. The runtime still initializes
fields, validates documents and enforces transaction ownership. Narrow local
assertions identify state already established by those owners: a validated ID,
a started write transaction, registration-compiled resource/callback maps and
relationship cardinality established by the request/schema contract. TypeScript
does not infer those mutations across async calls, nor derive a relationship's
cardinality from a schema lookup. The assertions do not validate unchecked hook
output or unknown driver values. `get-related` reuses the target scope after its
existence guard and narrows single linkage before reading ID/type; its pivot
assertion follows the registered many-to-many branch. Imported schema-validation, relationship
planning, conversion and versioning functions still have their own checking
scope; annotating their return contract does not check their full bodies.

`tests/types/lifecycle-context-contracts.ts` imports the real JavaScript methods
and helpers. It verifies valid mutable contexts and shared storage requests,
then requires compiler errors for raw processing input passed to setters,
invalid database/transaction handles, non-record attributes, invented transaction
outcomes, single/collection confusion, unknown scalar values, non-callable
setters, incomplete schema validators and a presumed scalar storage POST result.

Two runtime corrections accompany this work. POST now validates the unknown
storage return before publishing its ID to later hooks. Nonempty string and
finite number IDs retain their values; native bigint IDs become lossless strings.
Missing/object/empty/non-finite IDs reject and roll back for every `returning`
mode, without invoking the custom ID normalizer a second time. Relationship GET
and related-resource GET now initialize the actual parent `scopeName` before
permission hooks, replacing a stale caller value.

Node 24.6.0 verification for this batch: after the entry/stage correction, the
six-file lifecycle selection passed 156 tests in ordinary SQLite and 171 in
canonical SQLite, with no skips. A final ordinary ID/context smoke selection
passed 33 tests. The selection includes existing schema enrichment, relationship
writes/setters, bigint IDs and the new storage-return/scope-context regressions.
Seven malformed-ID full-return cases and both relationship scope cases failed
before their corrections; the final checks cover all three returning modes.
The internal typecheck and affected-file lint passed. Native driver verification
and the broader final acceptance checkpoint are recorded separately by the owning
work ledger; these SQLite results do not imply native coverage.

## Storage operation implementation checks

The earlier boundary-only entries above describe intermediate checkpoints. The
ordinary and canonical storage operation bodies are now checked, as are the
resource lifecycle bodies described in the preceding section. This supersedes
the earlier statement that annotating the plugin helper signatures left all
their implementations unchecked.

`ordinary-data-helpers.js` and `canonical-data-helpers.js` both opt into
`@ts-check`. Their ordinary factory functions contain the actual existence,
POST, PUT, PATCH, DELETE, minimal single/batch read, full GET and QUERY bodies.
The checked bodies include sort-descriptor construction, query/count/cursor
coordination and the ordinary deferred relationship-ID subquery. The plugin
installers retain their existing registration/setup responsibilities and install
these helpers directly; no generic dispatch framework or new context protocol
was added. `knex-json-api-transformers-querying.js` also checks its base resource
converter and complete ordinary single/collection response assembler. Existing
checked adapter, mapping, query-unwrapping and belongs-to conversion owners
continue to supply their respective contracts.

The helper signatures reuse `storage-types.d.ts`, the public resource/document
representations and the existing Knex database/transaction types. Attribute and
serializer values remain unknown. Single minimal reads require an ID and return
a nullable resource; batch reads return arrays. Query implementations initialize
`returnMeta`, so callers do not have to supply it. Ordinary collection reads
require their filtering hook callback. Deferred filtering retains the existing
wrapped-builder contract and the existing unwrapping utility; no new runtime
builder adapter or duck-type guard was introduced to satisfy the compiler.

Two narrow SQL binding assertions remain: one `Knex.Value[]` assertion in each
minimal-reader implementation at the `whereIn` handoff. Custom serializer and
filter translation return types remain unknown. Knex's declarations cannot
express arbitrary values accepted or rejected by a configured SQL driver, so
these assertions mark that third-party boundary; they do not claim that custom
serializer results are statically validated. Materialized canonical records
must contain an actual logical resource ID before conversion. The ordinary
single-response assembler likewise checks whether a row exists before treating
it as a single resource.

Supporting pagination/cursor algorithms, include loading, canonical link-store
and relationship-reader bodies, and database value normalization remain outside
this body-checking increment. Called signatures were clarified where needed;
for example, `normalizeRecordAttributes` preserves its input document shape
instead of erasing it to `Object`. Such annotations do not check those entire
implementations. This is checked operation coordination and response assembly,
not a claim that every imported storage algorithm or the whole repository is
statically verified.

`tests/types/storage-implementations.js` imports both actual factories. Its six
negative cases reject batch/document confusion, a single read without an ID,
materialized rows in place of a wrapped filtering builder, an ordinary query
without its hooks, and assumed string results from either a serializer or filter
translation. Positive calls retain wrapped native builders and the distinct
single/batch result shapes.

Checking these bodies exposed two projection defects. A minimal batch lookup
could lose its ID projection when a filter hook selected an attribute; both
storage modes now restore distinct qualified IDs before using that query for
membership. Canonical single minimal reads now restore the full canonical row
after filter hooks change the projection, preserving identity and attributes.
The new storage-boundary regressions reproduce these failures before the fixes
and verify them with the same projection-changing hook afterward. Required
adapter lookups no longer retain unreachable nullable-adapter fallback branches;
canonical write paths that genuinely permit a fallback still retain it.

Node 24.6.0 verification for this storage increment:

- The seven-file SQLite selection passed 240 ordinary and 241 canonical tests,
  without failures, cancellations or skips. It covers storage boundaries,
  serializers, returned IDs, queries, related-storage boundaries, filtering
  context and reference sorting. Logs:
  `/tmp/jra-storage-focused-knex.log` and
  `/tmp/jra-storage-focused-anyapi.log`.
- The affected four-file native selection (storage boundaries, serializers,
  queries and reference sorting) passed 209 ordinary and 210 canonical tests on
  PostgreSQL 16.15, and the same counts on MySQL 8.0.46, without failures,
  cancellations or skips. Logs: `/tmp/jra-storage-native-pg.log` and
  `/tmp/jra-storage-native-mysql.log`. Both owned servers stopped and both
  temporary data directories were removed.
- After the final storage review, the three-file SQLite selection for storage
  boundaries, serializers and returned IDs passed 80 ordinary and 83 canonical
  tests, without failures, cancellations or skips. Logs:
  `/tmp/jra-storage-review-knex.log` and
  `/tmp/jra-storage-review-anyapi.log`.
- Internal typechecks passed at the storage checkpoints; affected-file lint and
  `git diff --check` passed. The later lifecycle/final combined checks are
  recorded by their owners. No comprehensive suite was rerun for this storage
  review, and these native selections do not claim comprehensive driver coverage.

The later packed consumer check caught a declaration-only boundary missed by
the internal `allowJs` compiler: `storage-types.d.ts` referenced two runtime
constant modules and a JavaScript-only fieldset typedef without published
declarations. Matching declarations now accompany the existing
`knex-constants.js` and `query-constraint.js` owners; the unique symbol describes
the actual exported runtime symbol. The constraint shape has one shared
definition, reused by the checked implementation, and request fields reuse
public `SelectionParams['fields']`. No executable runtime code changed for this
correction. Node 24.6.0 internal typechecking and packed public type checking both
passed afterward. The packed check verified 173 files, 28 runtime exports,
24 negative cases and 257 local documentation links; logs:
`/tmp/jra-storage-packed-boundary-typecheck.log` and
`/tmp/jra-storage-packed-boundary-public-types.log`. No runtime suite was rerun
for the declaration correction.
