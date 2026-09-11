# Resource metadata and cache inventory

**Current status:** A5-08 and A5-09 are complete. The [acceptance matrix](#cache-and-configuration-lifetime-acceptance) states the current contract; earlier audit checkpoints below document the findings and corrections that led to it. Other A5 requirements remain open.

This is the A5-01 source inventory for the library worktree, dated 2026-09-09.
It records the inspected implementation, reproduced defects and subsequent
corrections. Remaining A5 items retain their separate acceptance criteria.
Consumer migration and positioning
are paused; this inventory does not establish a new public customization API.

## Compilation and publication

The core's `scope:added` hooks validate relationships, call
`compileResourceSchemas`, validate include configuration and copy resource
options into scope variables. `compileResourceSchemas` calls the existing
`compileSchemas` function with the resource's options and variables. Requests
read the published metadata; they do not compile the resource afresh.

`compileSchemas` separates computed fields, supplies belongs-to types and pivot
search defaults, runs `schema:enrich`, creates the validation schema, generates
search fields, runs `searchSchema:enrich`, enriches/validates computed fields
through `computedSchema:enrich`, normalizes projections and compiles callback dependencies,
builds storage mappings, and publishes a new `vars.schemaInfo` object.
Computed extraction precedes enrichment. Field definitions and relationship
maps are shallow copies; the hook's `originalFields` comment does not enforce
immutability. Both `schemaStructure` and `searchSchemaStructure` are aliases of
their respective schema instance's `structure`, not independent snapshots.

Canonical storage now registers the enriched compiled configuration and attaches
its persisted descriptor to that compiled metadata. The second validation/search
compilation was removed. Resource operations, related-query maps and adapters
now resolve that published descriptor; they do not reload registry configuration
during data work. `createKnexTable` refreshes only the descriptor.
Canonical `addKnexFields` compiles a candidate,
allocates fields in an owned transaction, and publishes only after allocation
commits. Ordinary `addKnexFields` and `alterKnexFields` perform DDL; they do not
publish a replacement runtime schema. This distinction is already documented
in the [schema migration guide](../GUIDE/GUIDE_X_Knex_Schema_And_Migrations.md).

Sources: `plugins/core/rest-api-plugin.js`,
`plugins/core/rest-api-plugin-hooks/compile-resource-schemas.js`,
`plugins/core/lib/querying-writing/compile-schemas.js`, and both Knex plugins.

## Representations and consumers

Paths below are relative to `plugins/core/` unless explicitly stated otherwise.

| Facts | Existing representation and owner | Consumers and repeated derivation |
| --- | --- | --- |
| Authored fields and options | `scopeOptions.schema`, `.searchSchema`, `.relationships`, `.storage`, `.queryFields` and scope options | Core compilation; canonical `scopeOptionsRegistry` and persisted JSON; projection normalization and resource initialization also read authored options. |
| Validated attributes | `schemaInfo.schemaInstance` and its shared `schemaStructure`, built by `lib/querying-writing/compile-schemas.js` | Write validation, request contracts, field selection, serialization, filters and output conversion. Canonical registration now retains this structure. |
| Search/filter definitions | `schemaInfo.searchSchemaInstance` and shared `searchSchemaStructure`; `schema-helpers.js` merges explicit definitions with field search markers and adds index hints after enrichment | Request filter validation, ordinary/canonical filter translation, relationship sorting and labels. The canonical duplicate generation was removed. Cross-table index analysis still scans definitions per query. |
| Relationships and aliases | `schemaInfo.schemaRelationships` plus belongs-to definitions and `as` in `schemaStructure` | Request contracts, include traversal, relationship writes, field selection and plain output independently combine these sources. Canonical descriptors additionally contain persisted relationships, belongs-to mappings and allocated slots. |
| Logical IDs | `schemaInfo.idProperty`, scope `vars.idProperty`, resource `normalizeId` options/vars and canonical descriptor ID metadata | `resource-id-normalization.js` resolves the caller's normalizer without caching. Storage helpers resolve columns; JSON:API exposes `id`. Descriptor setup repeats ID fallback selection. |
| Physical fields and serialization | `schemaInfo.storage`, `storageInfo.fields`/`.columns` and each field's `definition`, from `lib/storage/storage-mapping.js` | Ordinary adapters use these mappings. Canonical adapters also capture descriptor fields, canonical configuration and slot maps. `getStorageInfo` derives an uncached fallback when compiled storage information is absent. DDL builds its own table context using the shared mapping function. |
| Getters and setters | `schemaInfo.fieldGetters`, `.fieldSetters`, `.sortedGetterFields`, `.sortedSetterFields` | The compiler validates stage availability and sorts once, including dependencies without callbacks. `enrich-attributes.js` and `common.js` execute the stored callbacks/order. Canonical descriptor refresh now retains the corresponding field definitions too. |
| Computed fields | `schemaInfo.computed`, separated before `schema:enrich`, enriched/validated by `computedSchema:enrich` before publication | Compiled `readDependencies` and `sortedComputedFields` define execution. Selection and enrichment traverse only the required edges; earlier computed results feed later callbacks. LabelPlugin derives candidates from the current attribute/search structures during each compilation. |
| Projection fields | Normalized `schemaInfo.queryFields`, declared by `rest-api-query-projections-plugin.js` during `schema:enrich` and compiled centrally | Name collisions are checked against the final attribute/computed/relationship/ID namespace. Selection, sort, getter dependencies, input stripping and output normalization read this compiled map. Projection storage/setter declarations reject compilation. `buildQueryFieldRuntimes` evaluates requested SQL projections with request context; those results belong to the request. |
| Visibility and query capabilities | Field flags, relationship include options, `vars.sortableFields`, default sort/limits and normalized projection flags | `knex-field-helpers.js`, `query-field-sort-helpers.js`, include helpers and response normalization derive selected fields, hidden dependencies and permitted sorts. The selection itself depends on the request. |
| Method request contracts | `schemaInfo.requestContracts`, built by `lib/querying-writing/request-contracts.js` | Writable attributes and relationship bodies derive from compiled field/relationship facts. Query contracts reuse the compiled search instance. Database existence checks and authorization remain imperative. |
| Connector schemas | `connectors/lib/transport-route-schemas.js` calls the same request-contract builder and converts its schema to JSON Schema | Fastify now resolves the current cached contract for each payload. Its exported route JSON Schema remains an initialization snapshot. Core validation looks up contracts during the operation. No separate authored connector schema is needed. |
| Output value definitions | `schemaInfo.outputFields` and `outputRelationships`, derived during compilation | Normalization reads these indexes for primary and included records. Entries reference existing compiled definitions; a new compiled owner replaces them. The traversal WeakMap still tracks record objects within one conversion, not schema metadata. |
| Temporal/cursor validation | Module-level temporal contracts in `database-value-normalizers.js`; per-compiled-schema cursor contracts in `query-field-sort-helpers.js` | Temporal contracts are reused by type/precision. Cursor contracts reuse scalar validation with captured type/validator handlers and distinct ID, nullable, no-trim and precision rules. Values and validation results are never cached. |

## Cache ownership and invalidation

| Cache or captured value | Lifetime/key | Existing refresh and risk to verify |
| --- | --- | --- |
| `vars.schemaInfo` | Resource instance; whole object published by compilation/descriptor refresh | Compilation owns declaration and publication snapshots. Descriptor refresh preserves compiled definitions while replacing the owner object. Direct metadata mutation is unsupported; no mutation fingerprint/version is maintained. |
| Autofilter field metadata | `schemaInfo.autofilter`, published with its compiled owner | `schema:compiled` validates each candidate before publication. Resolver values and authorization results remain per request; root resolver/preset registries retain installation ownership. |
| File-field discovery | WeakMap keyed by compiled `schemaInfo` | Reads compiled stored file definitions, including enriched MIME rules. Both empty/populated lists refresh with owner replacement; failed additions retain the owner. Backend handles retain identity while declaration data is copied. |
| Request contracts | One current contract set on a particular `schemaInfo`; JSON key contains resource name, include-depth limit and sorted sortable fields | A changed key replaces the retained variant. A new compilation loses the cache; descriptor-only refresh preserves valid contracts with unchanged definitions. In-place field/relationship mutations are not part of the key. |
| Ordinary/canonical storage adapters | Plugin-local map by scope name, reused while `cached.schemaInfo === schemaInfo` | Whole-owner replacement refreshes adapters. Direct descriptor/mapping mutation is unsupported. Canonical adapter closures capture the published descriptor and physical configuration. |
| Canonical registry descriptors | Registry-instance map of at most 100 recently used descriptors, keyed by `JSON.stringify([tenant, resource])` | Reads return clones and refresh recency. Transactional reads/writes do not publish or reorder committed entries. Successful owned writes use the same bound; invalidation, owned write failures and a refresh confirming removal evict entries. Resource operations use their published `schemaInfo.descriptor`; eviction does not unpublish it. |
| Canonical authored options | Plugin-local `scopeOptionsRegistry` by resource; tenant belongs to the plugin instance | Registration and field additions retain owned declaration snapshots; descriptor refresh updates the committed map. These inputs preserve callbacks that persisted JSON cannot represent. |
| Fastify write contracts | Resolved during payload validation from the resource's existing contract cache | Newly added relationship aliases exposed a captured-contract defect, now fixed. Route JSON Schema remains a registration snapshot; API documentation should be generated after declarations are finalized. |
| Projection definitions and label candidates | Projections and label candidates belong to the compiled schema | Canonical field additions rebuild both maps and reject new projection collisions before publication. Direct metadata customization is unsupported; supported field additions rebuild these definitions. SQL projection runtimes are assembled for each query. |
| Temporal contracts | Module-level map keyed by type and integer precision or `default`; only five built-in temporal types and default/0–6 precision are retained, at most 40 keys | Other precision declarations still validate but do not create retained entries. Contains reusable validation rules, not caller data. Any extension of the contract must also extend the key. No authorization result is stored. |
| Cursor contracts | WeakMap keyed by the owning `schemaInstance`, then normalized scalar definition (`type`, `noTrim`, `nullable`, optional `temporalPrecision`) | Each cache captures that schema's type/validator registries. Recompilation supplies a new owner; descriptor-only refresh retains the same owner. Invalid/noninteger precision declarations bypass keyed reuse. Keys contain declarations, never cursor values, callers or tenant data. |
| Query/projection/adapter utility maps | Query invocation or adapter instance | Projection runtime maps and `storage-adapter-utils.js`'s scope cache are local work state. The canonical query proxy's alias/descriptor maps and builder WeakMap were removed with that proxy. They should not become global caches of context-dependent SQL or policy results. |
| Traversal/selection maps | Individual include, filter, fieldset or output conversion | Track joins, IDs, selected fields, visited objects and visible results for that operation. They are not duplicate persistent schema caches. |
| Plain included-resource lookup | One nested type/ID map for a document conversion, shared across primary records and recursive expansion | Replaces measured repeated scans, retains the first matching record and contains only input references. It is discarded after conversion; branch-local ancestor sets still prevent cycles without suppressing repeated siblings. No caller, policy result or row is retained across calls. |

Sources include `lib/querying-writing/request-contracts.js`,
`lib/storage/storage-adapter.js`, both Knex plugins,
`lib/anyapi/anyapi-registry.js`,
`lib/querying/storage-adapter-utils.js`, `rest-api-label-plugin.js` and
`connectors/fastify-plugin.js`.

The [A8-09 measurement and retention review](query-measurements.md#metadata-cache-retention)
records why this reuse stays, its bounds and its database cost. It also covers
the resource-name cache-key correction and stale descriptors after a refresh
confirms removal. This does not settle the broader A5 contract for mutable
configuration or establish a bound on whole-response memory.

## Reproduced defects

**A5-F1 — Search enrichment received the attribute map (A5-02/A5-03; fixed).**
`searchSchemaContext.fields` is assigned `schemaContext.fields`, while
`originalFields` is the generated search map. The search schema is subsequently
created from `rawSearchFields`, ignoring replacement of the hook's `fields`.
A hook adding `nameAlias` therefore adds an attribute to the main schema and
leaves the search alias absent. This is reproduced in both storage modes.

Regression acceptance: hook additions, changes, deletions and replacement of
the search map must affect filter validation/execution without changing writable
attributes. Cover resources with no initial search fields and verify the hook
runs once for each supported compilation. A local compiler correction is
justified; there is no need for another schema abstraction.

**A5-F2 — Canonical rehydration overwrote enriched definitions (A5-02/A5-08; fixed).**
With authored `name.type = 'string'`, `schema:enrich` changing it to `number`
produces `schemaStructure.name.type = 'number'` in ordinary storage. Canonical
rehydration restores `string` from persisted authored JSON, while the retained
`storageInfo.fields.name.definition.type` remains `number`. Validation and
storage metadata disagree. The same rehydration path regenerates search fields
without running `searchSchema:enrich`.

Regression acceptance: validation, storage type/allocation, search definitions
and callbacks must agree after registration, repeated table creation, field
addition and restart. Test hook removal/replacement, not only additions.
Persisted fields absent from fresh source need an explicit decision and tests;
existing restart coverage supplies expanded declarations, and JSON cannot
restore executable callbacks. Do not merge old compiled search entries back
over a new map if that would undo a deliberate deletion. Do not run enrichment
twice merely to compensate for overwritten results.

The pre-fix initialization probe uses `createSearchSchemaMergeApi` from the shared
fixture, with hooks installed before registration. It changes `products.name`
to number, records both hook maps and adds the numeric search alias. Its results:

| Observation | Ordinary | Canonical |
| --- | --- | --- |
| Compiled `name` type | `number` | `string` |
| Storage definition's `name` type | `number` | `number` |
| `nameAlias` present in main schema | yes | yes |
| `nameAlias` present in search schema | no | no |
| Both structures alias their schema instance | yes | yes |

The probe and raw logs are `/tmp/library-schema-compilation-probe.mjs` and
`/tmp/library-schema-compilation-probe-{regular,canonical}.log`. These are
initialization/metadata observations, not tests of stored values or HTTP.
To reproduce from the repository root with Node 24 selected:

```js
import { createSearchSchemaMergeApi } from './tests/fixtures/api-configs.js'
import { createTestDatabase } from './tests/helpers/test-database.js'

const database = await createTestDatabase()
try {
  const api = await createSearchSchemaMergeApi(database.knex, {
    hooks: {
      'schema:enrich': {
        functionName: 'probe-field-type',
        handler: ({ context }) => {
          if (context.scopeName === 'products') context.fields.name.type = 'number'
        }
      },
      'searchSchema:enrich': {
        functionName: 'probe-search-map',
        handler: ({ context }) => {
          if (context.scopeName !== 'products') return
          context.fields.nameAlias = { type: 'number', actualField: 'name', filterOperator: '=' }
        }
      }
    }
  })
  const info = api.resources.products.vars.schemaInfo
  console.log({
    type: info.schemaStructure.name.type,
    storageType: info.storageInfo.fields.name.definition.type,
    attributeAlias: Object.hasOwn(info.schemaStructure, 'nameAlias'),
    searchAlias: Object.hasOwn(info.searchSchemaStructure, 'nameAlias')
  })
} finally {
  await database.close()
}
```

Run as an ESM script in each storage mode; set `JSON_REST_API_STORAGE=anyapi`
for canonical storage. The corrected implementation produces numeric types in
both views, an absent attribute alias and a present search alias in both modes.

## Implemented corrections and regression boundaries

`conformance-schema-enrichment.test.js` verifies hook mutations, replacement,
deletion, the first search filter, callbacks, storage allocation, public queries,
canonical repeated table creation, additions and restart. The compiler now
supplies a separate search map and compiles its final value. Canonical
registration persists compiled definitions and `refreshStorageDescriptor`
attaches physical metadata without rebuilding validation/search schemas.

**A5-F3 — Fastify captured an obsolete relationship contract (A5-05/A5-08;
fixed).** Real HTTP tests showed ordinary added attributes working, but a newly
added belongs-to alias returned 422 from Fastify after programmatic calls and
Express accepted it. The validator now resolves the current cached contract.
POST/PUT/PATCH accept the new alias and still reject invalid cardinality.
The published route JSON Schema remains an initialization snapshot. Relationship
routes are already registered with a generic `:relationshipName` parameter.

**A5-F4 — Re-registration could reinterpret occupied slots (A5-02/A5-08;
guarded).** Applying previously ignored enrichment can change canonical slot
allocation. Three regressions reproduced registration accepting a changed pool,
removed stored field or reordered slot assignment on populated resources.
The registry compares old/new field layouts inside its metadata transaction and
rejects removal/remapping when records exist. Rejection preserves rows and
metadata; empty resources can change layout, and explicit unchanged old slots
can accompany new allocations. This does not migrate data or validate semantic
changes that retain the same storage layout.

The registry's existing registration replaces declarations; it does not merge
undeclared persisted fields back into fresh source. The selected contract is
therefore to keep expanded declarations/callbacks and an explicit slot map in
application source. The new guard prevents omitted stored fields from silently
being reassigned while records exist. Migration steps are in the
[API guide](../GUIDE/MIGRATING_API_V2.md#schema-enrichment-and-canonical-registration).

These changes reuse `compileSchemas`, `getRequestContracts`, the existing
descriptor registry and their caches. No parallel schema system or legacy
translation path was introduced. Exact verification is in the
[evidence log](verification-progress.md).

This completes A5-05 with shared contract/export checks, actual HTTP validation
and the full/native conformance gates. The broader metadata, dependency,
configuration-lifetime and consumer-migration criteria remain open. The layout
guard does not coordinate schema migration with concurrent application writers.

## Further reproduced defects and corrections

**A5-F5 — Automatic labels disappear after canonical field additions
(A5-02/A5-04/A5-08; fixed).** A Node 24 public POST/GET probe
with `createSchemaEnrichmentApi(..., { storage: 'anyapi', label: true })` returned
`label: 'Label remains'`. After `addKnexFields` added an unrelated nullable
string, GET omitted the label and the new `schemaInfo.computed` had no label
entry. LabelPlugin injects it in `scope:added`; candidate recompilation does not
run that extension. Regression acceptance includes preserving/recomputing label
metadata and dependency selection through supported resource recompilation,
without copying stale derived definitions forward. Raw output is in
`/tmp/library-label-recompile-probe.log`.

The correction moves LabelPlugin's derivation from `scope:added` to
`computedSchema:enrich`, called by the existing compiler after both attribute
and search enrichment and before metadata publication. This is a narrow
extension boundary for derived output fields, not a second schema compiler.
Copying the previous generated label would retain stale candidates, while
rerunning all registration hooks would repeat routes/storage registration.
Computing candidates earlier would miss final search-hook replacements.

The hook receives mutable computed `fields`, original computed declarations,
the final attribute/search structures, logical ID property, scope name and
options. Authored and generated definitions share validation; collisions with
stored attributes fail compilation. A rejected canonical candidate leaves the
published metadata and stored records unchanged. Shared tests cover mutation,
replacement, deletion, awaited hooks and invalid definitions. Canonical tests
cover repeated additions, changed search sources, explicit labels, disabled
labels, failed compilation, descriptor refresh and restart.

**A5-F6 — Falsy computed callbacks bypassed validation (fixed).** The compiler
checked callback truthiness before its type. Authored `compute: null`, `false`,
`0` or `''` therefore registered successfully and silently produced no field.
The Node 24 public probe is `/tmp/library-computed-falsy-probe.log`.
The corrected check accepts an omitted callback but rejects any supplied
non-function, after enrichment. Authored and hook-generated cases now use the
same validation; the migration guide explains how to retain deliberately
hook-supplied computed values. The clean pre-fix regression run passes four
already-rejected values and fails eight falsy cases across the two origins:
`/tmp/library-computed-callback-clean-before.log`.

**A5-F7 — Dependency ordering and sparse fetching disagreed (fixed in the
A5-04 implementation).** The probe in `/tmp/library-field-dependency-probe.log`
showed ordinary fields were incorrectly rejected as getter/setter prerequisites.
The computed-chain probe in `/tmp/library-computed-dependencies-probe.log`
returned an undefined prerequisite in both full and sparse reads. Computations
ran in declaration order, and intermediate results were not visible to later
callbacks. Selection only fetched direct stored dependencies.

`compileFieldDependencies` now reuses `topologicalSort` to validate and compile
getter/setter/computed orders and direct read edges. The obsolete sorting wrapper
was removed. Selection and enrichment share `getFieldDependencyClosure`; they
traverse requested edges rather than recompiling or sorting per record. Hidden
inputs can be explicitly required, but visibility is applied after callbacks.
IDs use callback `id`; relationship backing fields are unavailable as read
attribute dependencies. Setters only process available validated input, without
new implicit reads. SQL projections are declared in `schema:enrich`, normalized
against the final namespace and published in `schemaInfo.queryFields`. All
runtime projection consumers use that map; there is no old-path copy.

**A5-F8 — Virtual write input leaked across response records (fixed in the
A5-04 implementation).** Enrichment copied a parent's virtual values onto any
included resource with the same virtual field name. The regression checks
POST/PATCH/PUT with same-type and different-type includes, both formats and
inherited GET/query contexts. The clean pre-fix run had one pass and seven
assertion failures in `/tmp/library-virtual-owner-clean-before.log`.

The existing full-response read now receives a copy of the input document with
the written ID. Enrichment checks that identity and primary-resource ownership
before adding selected/required virtual input. Virtual getters run before
computations with their dependencies fetched; unused virtual input does not
trigger callbacks. A separate sparse-selection regression failed before that
correction (`/tmp/library-virtual-selection-before.log`).

**A5-F9 — Hidden sort eligibility contradicted response visibility (corrected
under A5-03/A5-10).** Explicit sortable stored fields could be hidden from
selection, leaving cursors without their sort value. Sortable hidden projections
were selected internally and their values escaped through cursor metadata and
links. Both storage modes reproduced the defect. The existing effective-sort
helpers now resolve the actual compiled definition, exclude hidden fields from
request capabilities and reject hidden sort keys during compilation/execution.
Projection sortable flags and include ordering reuse that check. Hidden
dependencies remain available to callbacks; normally-hidden fields remain
publicly readable and sortable. The regression suite and broader gate results
are tracked in the [hidden-sort evidence](verification-progress.md#2026-09-10-hidden-sort-visibility).

**A5-F10 — Storage naming lookup accepted inherited/coercible keys (fixed).**
The direct normalizer returned inherited values for `constructor`, `toString`
and `__proto__`. Resource compilation rejected those later when revalidating,
but accepted an object coercible to a valid naming key. The normalizer now
requires an own string key in the existing alias table. Direct and registration
regressions preserve all supported naming spellings.

**A5-F11 — A missing reverse mapping deleted an unrelated attribute (fixed).**
For a partial canonical descriptor, deleting
`attributes[descriptor.reverseAttributes?.[idColumn]]` could remove the literal
attribute `undefined`. Conversion now removes the backing attribute only when
its mapping exists. A direct regression preserves that attribute and the
relationship linkage. The strict indexed-access check exposed this unsafe
lookup; see [type-checking evidence](verification-progress.md#2026-09-10-incremental-storage-type-checking).

**A5-F12 — Prototype-named attributes are inconsistent (partly fixed; open,
A5-03/A5-10).**
A read-only public probe (`/tmp/library-special-field-public-probe.log`) declares
string attributes named `constructor` and `toString`, writes `Special`, then
reads them. Ordinary storage returns null; canonical storage retains `Special`.
The ordinary serializer tests `fieldName in computed`, so inherited properties
are mistaken for computed fields. A direct mapping probe
(`/tmp/library-storage-special-fields-probe.log`) also loses `__proto__` metadata
and row keys through ordinary object assignment; public writes using that
declaration currently reject schema validation in both modes.

Regression acceptance: define and test the supported field namespace at
compilation, preserve declared ordinary string fields through write/read and
both formats, and audit equivalent dictionary lookups/assignments. Verify that
unsupported declarations reject before data work instead of silently dropping
values. The newly introduced type checker does not establish this runtime
namespace contract; the finding remains open.

The first correction replaces inherited membership checks in ordinary writes,
generated search definitions, virtual-input enrichment and getter/setter
execution. Canonical writes require an own slot mapping before persisting a
field. Sort visibility resolves own query-field definitions before stored
definitions, so an inherited name cannot mask a stored field's hidden flag.
Missing row values and reverse mappings no longer return prototype functions.

`tests/conformance-field-names.test.js` covers eight declared names, both
representations and ordinary naming modes, POST/PATCH/PUT, sparse reads,
filtering, cursor traversal, callback presence/dependencies, hidden-sort
rejection and undeclared fields. `constructor` and `prototype` use explicit
physical mappings in ordinary storage; canonical slots retain those public
names without an override.

The dependency probe in `/tmp/library-field-names-knex-dependency.log` showed
that Knex 3.1's update compiler discards physical keys `constructor`, `prototype`
and `__proto__`, even with its single-column overload or a null-prototype input.
Those physical mappings and ID columns now reject at the ordinary registration,
adapter and table/migration boundaries. The
[migration guide](../GUIDE/MIGRATING_API_V2.md#public-field-names-and-physical-columns)
explains explicit mappings and existing-column migration. No dependency code,
automatic column rename or compatibility wrapper was added.

The second correction rejects `__proto__` declaration keys and custom-prototype
declaration maps before copying, then rechecks mutable enrichment output.
Plain and null-prototype maps with own declarations are supported. Field
additions and direct canonical registration/allocation use the same checks;
descriptor loading rejects invalid persisted field names and aliases before
constructing its dictionaries. Nested JSON keys and resource ID values remain
data, with positive round-trip coverage.

The relationship/resource audit reproduced further failures: ordinary include
trees skipped inherited aliases, polymorphic type grouping called `.includes`
on an inherited function, canonical includes mistook an inherited belongs-to
entry for a polymorphic relationship, and resource fieldset lookup read an
inherited function as a requested field list. Own membership and own property
creation fix those paths. One shared `getResourceFieldset` lookup in the existing
field utilities serves selection, enrichment and response filtering. Direct
foreign-key attributes named `constructor` now receive the same validation error
as other foreign-key attributes, instead of being silently removed.

The schema dependency itself preserves all three original probe names;
`/tmp/library-field-schema-dependency-probe.log` confirms own keys survive its
`create()` validation. `hooked-api` separately rejects resource names
`__proto__`, `constructor` and `prototype`; the library retains that upstream
contract while testing other prototype-named resources. The migration guide
documents these distinct namespaces. Full JSON:API member-name grammar and
broader namespace/capability conflicts remain under A5-03/A5-10.

A third correction removes the canonical plugin's second include-tree parser.
Its single-level output was correct, but a public nested
`constructor.constructor` include added an own `constructor` property to the
built-in `Object` function. Nested `toString.toString` also mutated an inherited
function. The shared include parser already handles own entries safely, and is
now used by both plugins. Three public nested-alias regressions check the
included records and preservation of the original function properties.

**A5-F13 — Minimal reads translated column mappings twice (fixed).**
`toJsonApiRecordWithBelongsTo` translated the raw row, then passed that logical
row to `toJsonApiRecord`, which translates it again. When logical `first` maps
to column `second` and logical `second` maps to column `third`, the second pass
overwrites `first` and loses `second`. This also exposed inherited reverse-map
entries for camel-case prototype names. The helper now passes the raw row to
the JSON:API converter and uses its separately translated row only for
relationship linkage. Public PATCH/PUT regressions inspect the minimal record
seen by write hooks and verify both mapped values in both storage modes and
representations.

**A5-F14 — A cold canonical descriptor read escapes the write transaction
(fixed).** Registry tamper-test cleanup invalidated its descriptor
cache; the next POST held SQLite's only connection and attempted to load the
descriptor through the global Knex pool. The independent public probe
`/tmp/library-cold-descriptor-write-probe.log` uses a single connection and a
100 ms acquisition timeout: cold POST fails after 109 ms with zero stored rows;
loading the descriptor before the next POST makes that write succeed. The
plugin's `getDescriptor` closure did not pass the operation transaction to
`registry.getDescriptor`, although the registry already accepts it.

The namespace tests restore the pre-test descriptor cache along with tampered
metadata rows; that is fixture cleanup. The first runtime correction forwarded the
active transaction through the existing descriptor helper, many-to-many inverse
resolution, include/linkage loaders and related-descriptor preloading for
queries/counts. Configuration refresh outside an operation retained the normal
registry path. No registry cache or transaction ownership policy changed. The
subsequent A5-F15 correction removes those request-time registry reads entirely.

The new one-connection suite verifies cold CRUD, PUT-create, relationship writes,
nested reads, finish failure, rollback and preservation of borrowed ownership.
Transactional descriptors never enter the committed cache. The existing real
concurrency suite now starts canonical scenarios with invalidated descriptors;
the failure-injection suite intercepts the actual transaction as well as the
global database connection. The full Node 24 gate and six-file native matrix
pass; see [verification evidence](verification-progress.md#2026-09-10-cold-descriptor-transactions-and-shared-include-parsing).

**A5-F15 — Transactional descriptor reloads repeat metadata queries (fixed).**
Forwarding the active transaction made the registry's
existing cache-bypass rule apply to resource operations. A Node 24 SQLite probe
compares a wrapper reproducing the previous warm-cache path with the corrected
path on the same fixture. A full PATCH without explicit includes goes from
9 queries (0 metadata) to 30 (21 metadata); adding `group.items` goes from
15 (0 metadata) to 57 (42 metadata). These are statement counts for those exact
shapes, not latency/throughput measurements or universal query budgets.

The adapter already captured `schemaInfo.descriptor`, so live registry reads
also supplied a potentially different mapping to other parts of the same
resource. The correction makes those consumers use the published descriptor as
well. Related-query preloading is a synchronous traversal of published resources;
the query adapter's unused registry member and repeated ID fallback selection
are removed. This avoids adding a transaction/request cache, cache keys or
invalidation machinery, and does not share uncommitted registry values globally.

Direct registry reads retain their previous transaction/error rules. Direct
registry or raw metadata changes do not become resource configuration implicitly.
Tests use distinct old/new slots to verify consistent reads/writes before and
after explicit refresh, retain the previous publication on refresh failure,
keep borrowed registry additions separate, and isolate overlapping tenant APIs.
Supported field additions still publish only after their owned metadata
transaction commits. Arbitrary concurrent/in-place reconfiguration remains
outside this correction and under the broader A5 work.

The existing benchmark script now reports metadata-query counts and write
scenarios. In its books fixture, full PATCH drops from 32 to 11 statements and
nested PATCH from 59 to 17, with zero metadata queries. Two post-change runs
match all statement/result counts; ordinary storage counts are unchanged.
The earlier probe was `/tmp/library-descriptor-transactions-query-cost.log`;
the reproducible [measurement guide](query-measurements.md) documents the current
script, exact shapes and limitations. Request-time database-descriptor failure
injection tests were replaced with direct registry/refresh failure tests,
unavailable-registry HTTP checks and zero-metadata-query resource regressions.
The full Node 24 gate and native matrix pass; see
[verification evidence](verification-progress.md#2026-09-10-published-descriptors-and-query-measurements).

## Remaining risks and smallest useful next steps

Canonical sort descriptors now use the compiled field definition instead of the
persisted descriptor's JSON copy, which loses serializer functions. Projection
getters now enter the existing compiled callback graph; hidden dependencies,
awaited order, invalid declarations and error propagation are tested alongside
stored-field getters. ID/relationship serialization is rejected before metadata
publication, including failed canonical field additions.

Cursor contract reuse is implemented for A5-07. The previous per-field
`createSchema` call was measurable overhead, and it also read the latest global
handlers rather than those captured by the resource. The correction retains
the existing temporal cache and adds a small cursor cache owned by the compiled
schema. An isolated Node 24 benchmark (`scripts/measure-cursor-validation.js`)
measures 10,000 four-field validations per round: the median of five rounds
fell from 1241.358 ms to 85.768 ms. This is a validation microbenchmark, not
end-to-end query latency or a throughput guarantee. Correctness coverage
includes registry snapshots, invalid/nullable/opaque/temporal values, repeated
and nested calls, and separation from output precision conversion.

The broader compiled-metadata consumers,
configuration lifetime and invalidation, initialization costs and consumer
migration remain separate A5 work. Field-definition objects remain mutable;
this change does not establish arbitrary live-edit support or a new configuration
versioning system. The final verification results for dependency work are tracked
in the [evidence log](verification-progress.md).

## Explicit field maps and the structure-name collision

`getForeignKeyFields` previously guessed between a Schema wrapper and a field
map using `schema.structure || schema`. Compiler validation, dependency compilation, labels, field selection and
minimal reads supplied field maps. An aliased response-conversion caller supplied
a Schema instance and has now been migrated to the compiled field map too. A legitimate `structure` attribute therefore hid
ordinary relationship fields from those consumers. Two regressions establish
both the empty relationship-field result and the resulting missed initialization
rejection for an identity serializer.

The helper now takes the explicit field map. Existing runtime callers require no
conversion or parallel compiled metadata. Extensions using a Schema wrapper must
pass `.structure` explicitly; the migration guide records this internal contract
change. This fixes one A5 metadata ambiguity; it does not complete broader
metadata authority, mutation lifetime or consumer migration requirements.

The follow-up DDL probe confirms another instance in `resolveTableSchemaContext`:
`generateKnexMigration('items', { structure: { type: 'string', nullable: true },
title: { type: 'string' } })` generates columns named `type` and `nullable`,
whereas wrapping that field map as `{ structure: fields }` generates `structure`
and `title`. This is not fixed by the foreign-key helper change. Create/migration
helpers accept schema wrappers and maps, while add/alter callers mix those forms.
Their next migration needs an explicit input contract and caller updates, rather
than another attempt to infer whether a property is a field or metadata.

The isolated table-helper draft now requires one explicit `{ structure: fields }`
shape across create/add/alter/generation/diff helpers. Six SQLite probe cases pass:
one verifies generated column names; five verify ambiguous bare maps reject with
no emitted SQL. A TypeScript-AST call-site inventory found 75 direct calls across
the ordinary plugin and seven test files. Initial caller migrations are overlaid
only in `/tmp/library-table-schema-draft.json`, with
`/tmp/library-table-schema-loader.mjs` and
`/tmp/library-table-schema-probe.test.mjs`; this is not applied library code.
The public resource methods retain their existing arguments; their storage-helper
boundary performs the explicit wrapping. The caller-selection experiment log is
`/tmp/library-table-schema-caller-probe.log`.

The initial draft ports 13 calls in three files (one plugin call and twelve test
calls); existing wrapped calls remain unchanged. The overlaid direct-table,
introspection, schema-conformance, capability-preflight and field-alteration
selection passes all 130 tests on SQLite. These results cover draft source, not
the applied runtime or native databases. The active library remains at the
foreign-key caller-correction checkpoint until its full verification completes.

The focused draft probe has expanded to ten passing cases, checking null/missing
schemas, array structures and invalid field definitions across all five helpers
without SQL. The exact proposed migration text is prepared separately in
`/tmp/library-table-schema-migration.md`; it is not yet published as an applied
API contract. Public resource-method argument shapes remain unchanged in the
draft. The active foreign-key correction still awaits its full gate.

The draft's PostgreSQL selection passes 120 tests per runner storage setting
(240 total); it exercises ordinary table helpers in both settings, not canonical
DDL. Its disposable server and directory are removed. MySQL's matching draft
selection is in progress. Native draft logs use
`/tmp/library-table-schema-draft-native-`; the active full-gate source remains
unchanged and does not contain these drafts.

MySQL's isolated draft selection also passes: 107 tests per runner setting (214
total), with its server and directory removed. Combined native draft evidence is
454 passes, zero failures/skips. Different PostgreSQL/MySQL totals reflect the
existing dialect-specific schema tests. No loader is installed in the library.

## Applied table-schema contract

The previously described draft is now applied. Every direct table helper requires
`{ structure: fields, ...metadata }` (a Schema instance already supplies it).
Field definitions must be objects; invalid/missing/ambiguous maps fail before
SQL or migration output. The ordinary resource plugin wraps its existing
`alterKnexFields({ fields })` argument internally; public resource call shapes
are unchanged. Thirteen direct caller updates and the new regression suite are
applied, with migration/reference documentation. Normal-import tests pass; the
[verification log](verification-progress.md#2026-09-11-explicit-table-schemas-applied)
distinguishes applied checks, native-tested identical draft source and the
preceding full-gate checkpoint. The earlier draft paragraphs record investigation
history, not the current implementation state.

## Compiled maps in response and include consumers

Response construction, belongs-to conversion, include metadata/traversal and
field selection now read `schemaInfo.schemaStructure` directly. The compiler's
published field map is their declaration source; they no longer infer maps from
`schemaInstance`. Validation retains its schema instance. The now-unused
`getSchemaStructure` helper is removed, and the synthetic error-boundary fixture
supplies the same compiled map shape as registered resources.

This changes no field definitions, cache keys or runtime mutation policy. The
selected GET/query/include, bigint-ID, permissions and metadata-error suites
verify behavior using normal compiled resources. Extensions that construct
synthetic metadata must supply the compiled map explicitly, as documented in the
migration guide. A5's wider authority/configuration-lifetime work remains open.


## Authored nested storage mutation: configuration lifetime evidence

**A5-F16 — Nested storage declarations remain live after compilation (corrected;
see the lifetime acceptance below).** A Node 24 probe using `createSchemaEnrichmentApi` and the shared
conformance fixture establishes this in both actual storage modes on SQLite.
The compiler's field spread does not detach `definition.storage`; the installed
schema factory passes the structure directly to its Schema instance. Hooked-api
freezes the outer scope-options object only. Consequently, mutating the original
`fields.name.storage` also mutates `schemaInfo.schemaStructure.name.storage`.

Reproduction: register a searchable string `name` with
`storage: { column: 'name' }`, create a record, then assign
`storage.column = 'renamed_name'` and
`storage.serialize = value => 'replacement:' + value` on the original field
object. Create another record with name `after`, and inspect the adapter's
`translateFilterValue('name', 'after')` result.

| Observation after the authored mutation | Ordinary storage | Canonical storage |
| --- | --- | --- |
| Declared column in compiled field definition | `renamed_name` | `renamed_name` |
| Cached column in `storageInfo.fields.name` | `name` | `name` |
| Newly created resource's name | `replacement:after` | `replacement:after` |
| Translated filter value | `after` | `replacement:after` |

Repeating with a serializer present at registration makes both filter paths use
the replacement callback. The ordinary filter branch tests the originally
captured `storageInfo.fields.name.serialize`, then invokes the callback through
the still-live field definition. The canonical branch tests the current field
definition. This explains the mode difference without a database-specific cause.
The experiment contains four scenarios, not a full conformance suite or native
server verification. Temporary script and output:
`/tmp/library-configuration-lifetime-probe.mjs` and
`/tmp/library-configuration-lifetime-probe.log`.

The migration contract already disallows arbitrary in-place metadata edits.
This finding does **not** introduce support for those edits or prove supported
field additions broken. It demonstrates that the current initialization boundary
is only partially enforced. Before choosing a snapshot/finalization change,
cover both authored and enrichment-hook references, callback preservation,
nested validation declarations, and the explicit `addKnexFields()` recompilation
path. Preserve forward resource registration and the existing failed-refresh
publication guarantees. Do not add an invalidation framework to accommodate
unsupported mutations. This was an audit-only checkpoint; the later implementation and acceptance sections record the correction.


## Compilation snapshot implementation

The compiler now snapshots its declaration input before enrichment and snapshots
the complete candidate metadata graph before publication. The existing
`schema-helpers.js` owns `snapshotResourceConfiguration`; there is no new schema
representation or runtime cache. A single WeakMap per snapshot preserves shared
field-map/definition references and cycles within declaration data. Published
`schemaInstance.structure` and `schemaStructure` still identify the same map;
`storageInfo.fields[field].definition` identifies the same compiled definition.

The schema dependency's existing introspection snapshots are inspection-only and
freeze values; they are not reused as runtime validation schemas. Nested runtime
schemas instead use the dependency's public `createFactory(schema)` API, retaining
custom handlers and operations. Plain declaration data, Date and RegExp values
are copied. File storage handles with `upload()` retain identity, as do callbacks
and opaque application class instances;
caller-owned objects are not frozen. The published schema is not a protected
proxy, and direct mutation of it remains unsupported.

This corrects A5-F16's authored/hook-retained reference leak for compiled declaration
data. The original reproduction above describes the pre-fix state. Broader
runtime-option lifetimes and the canonical registration input retained for later
recompilation still needed review at this checkpoint; the later acceptance completes A5-08/A5-09. Existing enrichment,
field-addition, structured-value and dependency-order suites exercise the
publication path; the dedicated configuration suite covers serializer presence,
callback identity, alias preservation, cycles, dates, regular expressions, opaque
objects and nested custom-schema validation.


## Retained registration inputs and sort options

The follow-up implementation snapshots canonical registration options when they
enter `scopeOptionsRegistry`, and snapshots each combined field-addition input
before compilation and retention. Thus later compilation starts from owned
source declarations rather than externally mutated objects. This is separate
from the compiler's publication snapshot: one protects the next compilation's
input, the other protects the current compiled resource. Existing metadata
transaction and descriptor-publication ordering is unchanged.

A public SQLite probe demonstrated the retained-input defect after the first
compiler fix: a changed authored serializer stayed inactive until
`addKnexFields()` recompiled the resource, then took effect on an existing field.
The regression now verifies both original registration inputs and previously
added field inputs remain detached through subsequent additions.

A second public probe demonstrated that authored `defaultSort` arrays were still
shared with resource variables: mutating `['name']` to `['-name']` reversed query
results in both modes. Initialization now copies `sortableFields` and
`defaultSort`, reusing the declaration snapshot helper. Tests preserve explicit
runtime variable assignments and verify later queries observe those assignments.
There is no sort-result cache to invalidate; each query resolves its effective
ordering from the current runtime variables and compiled field eligibility.

This resolves these demonstrated authored-reference leaks. It does not establish
that every plugin option or scope customization shares this lifetime. The broader
A5-08/A5-09 inventory remains open, including the distinction between runtime
variables and structural schema/mapping changes. Positioning and external
consumer migration remain paused.


## Plugin registry ownership and inherited names

**A5-F17 — Plugin registry lookups accepted inherited names (corrected).**
Autofilter preset/resolver lookup and row-policy lookup now require own registered
entries. Autofilter field lookup also requires an own compiled field. Resolver
normalization uses a null-prototype dictionary, preserving explicitly registered
`__proto__` entries without changing the dictionary prototype.

The 20-case regression covers `constructor`, `toString`, `__proto__` and
`hasOwnProperty` across row-policy names, autofilter resolver names, preset names
and schema fields, plus explicitly registered callbacks under each name. Before
the fix, 12 invalid configurations registered successfully, four unknown presets
produced malformed-preset errors, and explicit `__proto__` resolver introspection
omitted its entry (17 failures; three explicit-name cases passed). RowPolicy's
existing boolean-return guard remains in place: accepting an inherited callback
at initialization is not evidence of a silent unrestricted-query bypass.

Plugin configuration compiles callback references at resource registration.
The tests change application state captured by a legitimate policy callback and
verify that a subsequent query is denied, establishing that policy outcomes are
still evaluated per request. No authorization-result cache or new registry layer
is introduced. This closes the demonstrated lookup defect, not all plugin
configuration-lifetime or late schema-customization requirements.


## Cache and configuration lifetime acceptance

The [public lifetime contract](../GUIDE/MIGRATING_API_V2.md#when-configuration-changes-take-effect)
uses existing plugin installation, resource registration and explicit publication
boundaries. It adds no lifecycle framework or compatibility cache. Read this
acceptance matrix with the concrete cache-key table above.

| Requirement | Owner/key and refresh rule | Evidence |
| --- | --- | --- |
| Scope customization | Runtime hooks/helpers/default variables are read by subsequent calls; they do not replace compiled schema metadata. Request contracts retain one variant keyed by resource name, include depth and sorted allowed-sort names. | Public customization tests change response format/page defaults and install a runtime hook without rebuilding schema/contracts. Restricting/restoring sort fields changes validation and retained contracts while preserving adapter identity; metadata-cache tests also cover include depth and resource-name separation. |
| Query projections and derived labels | Definitions belong to a compiled `schemaInfo`; supported additions recompile them. SQL runtimes belong to one query and use that query's context. | Schema-enrichment tests cover repeated additions, label candidates, projection collisions and failed publication; dependency and projection conformance cover current values and execution order. |
| Physical mappings | Adapter lookup is plugin-local by resource name plus `schemaInfo` identity. Supported publication replaces the owner; direct mapping mutation is unsupported. | Adapter-lookup conformance covers owner replacement, scope and lookup-instance isolation, and missing-resource behavior. Schema-enrichment/field-evolution tests cover committed additions and failures retaining the prior owner. |
| Tenant descriptors | Registry-local JSON tuple key `[tenant, resource]`, bounded at 100 entries. Transactional reads bypass committed entries; committed writes/explicit invalidation follow the registry contract. Active resources use their published descriptor independently of registry eviction. | Metadata-cache, descriptor-transaction and registry-failure suites; earlier native retention measurements verify zero SQL on a hit and three statements on an evicted reload. |
| Runtime values and validation caches | Defaults and callback application state remain live. Temporal contracts use bounded type/precision keys; cursor contracts use a weak compiled-schema owner plus scalar declarations. No caller/row/permission result is cached. | Runtime customization, plugin registry/policy-state, temporal, cursor and metadata-cache conformance. |
| Initialization inputs | Canonical retained declarations and new addition inputs are copied; presets are copied at installation. Callback identity is retained. Mutable enrichment fields are detached from stage-original definitions and final publication. | Configuration-lifetime and plugin-registry suites exercise authored mutations, retained hook references, subsequent additions and nested attribute/search/computed metadata. |

Two final ownership regressions informed this contract. Autofilter presets were
still shared after installation, while resolver and policy maps already captured
their callback entries. The new regression changes all three authored inputs
after installation and now observes the installed preset/callbacks. Enrichment
fields also shared nested storage/search/dependency metadata with `originalFields`;
those three working maps now use the existing snapshot helper before hooks run.
Both regressions failed before their corrections.

An isolated Node 24 compiler benchmark alternated seven batches of 100
compilations after warmup, using 100 searchable stored fields and one computed
field. The median rose from **1.324ms to 1.884ms per compilation** when adding the
three enrichment-original copies (about 0.560ms). The baseline already includes
the preceding input/publication snapshots. This measures compiler work only,
not complete API startup, request latency or application throughput; no database
or consumer was benchmarked. The before variant used an isolated loader, never
shipped. Source and output are `/tmp/library-enrichment-copy-benchmark*.mjs` and
`/tmp/library-enrichment-copy-benchmark.log`.

This defines the A5-08/A5-09 lifetime requirements. It does not complete A5's
remaining metadata-derivation removal, value-boundary migration, impossible-schema
validation, consumer ports or broader performance criteria. The code remains
extensible through explicit runtime hooks and variables; it does not promise
arbitrary structural changes during active requests.


## Compiled output lookup indexes

The compiler now derives `outputFields` by joining the attribute, computed and
projection maps once, and `outputRelationships` by indexing declared relationships
and belongs-to aliases. Each entry references the existing definition object;
the publication snapshot preserves those aliases. These are lookup indexes, not
another authored schema, copied definitions, a query-result cache or a separate
schema compiler. Canonical owner replacement also replaces the indexes.

`normalizeRecordAttributes()` no longer spreads the three field maps for every
primary/included resource. Plain normalization also stops rebuilding its
relationship lookup by scanning every field. It still iterates the compiled
relationship index to traverse actual nested output and keeps the existing
record-local WeakMap for cycles. The standalone `normalizeAttributes()` signature
and normalization rules are unchanged. The single synthetic response-metadata
fixture now supplies an output field index; real resource fixtures obtain it
from compilation.

The new output-definition suite verifies identity with the existing stored,
computed, projected and relationship definitions; boolean normalization across
primary/included JSON:API and plain output; and index replacement after a
committed canonical field addition. Other metadata derivation and field-resolution
work remains open under A5-02/A5-03/A5-12.

See the [output normalization measurements](query-measurements.md#compiled-output-definition-lookups)
for request-side work and initialization cost. The
[migration note](../GUIDE/MIGRATING_API_V2.md#compiled-output-definition-indexes)
covers callers constructing synthetic scope metadata.

## Compiled foreign-key membership

`compileFieldDependencies()` already derives the relationship backing-field set.
It now returns that same set as `foreignKeyFields`; the existing schema compiler
publishes it with the other dependency facts. Identity serializer validation,
record conversion, SQL field selection and minimal reads reuse this compiled
fact. Consumers requiring additional IDs copy the set and preserve existing
iteration order. Canonical field additions replace the compiled owner and set.

The output-definition suite verifies read stability, unchanged membership after
minimal writes, and replacement/linkage after a committed belongs-to addition.
Record conversion also reuses that membership for polymorphic backing fields,
removing the wrapper's second relationship scan and temporary set. The existing
relationship-metadata error boundary now surrounds the compiled membership read;
tests retain typed errors, frozen Error causes and null throws. A compiled-resource
fixture verifies conversion no longer reads relationship declarations.
See the [measurements](query-measurements.md#compiled-foreign-key-membership).

## Relationship alias ownership

The compiler rejects duplicate ordinary belongs-to aliases and collisions
between an alias and a declared relationship. This closes a demonstrated
ambiguity: request contracts apply declared relationships after field aliases,
plain output applied field aliases after declared relationships, and field lookup
could take the first of two aliased fields. Rejection gives every accepted
relationship name one declaration without introducing a precedence convention.

The check runs on enriched fields and relationships before publication. It uses
a local name set during the existing belongs-to validation pass; no new retained
cache or request traversal is added. Forward target references are unaffected.
Tests cover authored/enriched collisions and canonical failed-addition rollback,
including published schema identity, descriptor fields, existing data and linkage.
Broader namespace, visibility and relationship resolution work remains under
A5-03/A5-10. See the [migration guide](../GUIDE/MIGRATING_API_V2.md#relationship-aliases-must-be-unique).

### Relationship markers on derived attributes

The read-only compiler probe `/tmp/library-derived-relationship-probe.mjs`
reproduces an additional A5-03/A5-10 ambiguity after ordinary alias validation:
both a computed field and a query projection can carry `belongsTo`/`as` and
replace a stored relationship's entry in `outputRelationships`. In both cases,
`findRelationshipDefinition(info, 'parent')` targets `items`, while the output
index targets `other`. The compiler accepts both declarations. The probe log is
`/tmp/library-derived-relationship-probe.log`.

The compiler now rejects both relationship markers on computed fields and query
projections after their enrichment and normalization. Output relationship index
construction scans only stored schema definitions and declared relationships.
Eight registration regressions cover both markers, both derived kinds and both
authored/enriched input. A canonical addition regression checks unchanged schema
identity, output index membership and existing plain relationship data.

The full alias-validation gate also exposed duplicate declarations in the shared
positioning fixture. Those redundant `category` and `project` entries were removed
from its relationship map; the stored fields still declare the same relationships.
The positioning implementation is unchanged. Selected verification and the full
follow-up gate are recorded in the verification log.

### Draft: reuse the relationship index for lookup

Historical draft record; the applied result is recorded below.

`findRelationshipDefinition()` still checks declared relationships and then scans
all stored fields for an ordinary belongs-to alias. Its callers include related
and relationship methods, field selection, include validation and to-one linkage
authorization. After the alias/derived-declaration fixes, the existing compiled
relationship index is a candidate for this lookup too.

An isolated loader draft changes only that helper to perform an own-property
lookup in `outputRelationships`, retaining null for absent names. It passes
**295 ordinary + 299 canonical SQLite checks** across related permissions,
include permissions, field names and output definitions, with zero failures,
cancellations or skips. The draft is not applied to repository runtime source;
the corrected full gate is still verifying the preceding source checkpoint.
Artifacts: `/tmp/library-relationship-lookup-loader.mjs` and
`/tmp/library-relationship-lookup-draft{,-anyapi}.log`.

The isolated lookup probe compares a compiled 101-field resource with one
belongs-to alias; 10,000 alternating present/absent lookups trigger 10,000 field-map
enumerations before and zero with the draft. It asserts definition identity and
unknown/prototype-name behavior. Timing samples were collected while another
verification job was active and are not used for a performance claim. The probe
is `/tmp/library-relationship-lookup-benchmark.mjs` with its `.log`.

Before application, review remaining accepted relationship declaration shapes,
synthetic metadata users and error boundaries. After application, run checks
without the loader and update the deep-helper migration contract. Do not retain
a raw-schema fallback merely to support synthetic metadata using the old shape.

### Draft prerequisite: polymorphic declarations belong in relationships

Historical draft record; the applied result is recorded below.

The accepted-shape review found another unresolved configuration inconsistency.
`/tmp/library-stored-polymorphic-probe.mjs` registers a stored field carrying
`belongsToPolymorphic` and `as` in both storage modes. Registration succeeds;
lookup returns null, the output index contains the relationship, and the compiled
foreign-key set is empty. Move this declaration to the resource's `relationships`
map, keeping its type/ID fields in the stored schema.

Two new public registration tests (authored and schema-enriched) fail with missing
rejections against current source. An isolated combined draft rejects this option
on stored fields during existing belongs-to validation, indexes only ordinary
belongs-to aliases from those fields, and reuses the compiled index for lookup.
It passes **78 ordinary + 101 canonical = 179 SQLite checks**, zero failures,
cancellations or skips, across the new declaration tests, enrichment, output
indexes and relationship metadata. This supplements the earlier 594-check lookup
draft; it is not a claim of applied-source verification.

Candidate artifacts are `/tmp/library-stored-polymorphic-candidate.js`,
`/tmp/library-stored-polymorphic-loader.mjs`,
`/tmp/library-stored-polymorphic-tests-body.txt`, and logs
`/tmp/library-stored-polymorphic-{before,draft-knex,draft-anyapi}.log`.
The loader also contains the drafted `findRelationshipDefinition` replacement.
Runtime source is still the 284-file derived-relationship checkpoint while its
full gate runs. Apply only after reconciling that checkpoint; then verify normal
imports, canonical failed-addition behavior, native databases, types and docs,
and document the polymorphic declaration location and synthetic lookup contract.

### Applied relationship lookup

The shared lookup now reads `outputRelationships` with an own-property check;
absent and inherited names return null. There is no raw-field fallback. This
serves relationship methods, include validation, field selection and to-one
linkage authorization through their existing calls to the same helper.

The compiler rejects `belongsToPolymorphic` on stored field definitions after
enrichment; polymorphic relationships belong in the resource relationship map.
Only ordinary belongs-to aliases are indexed from stored fields. Together with
the prior duplicate-name and derived-field checks, this removes the demonstrated
lookup/output disagreements before relying on the compiled index.

The normal-import output suite checks definition identity, unknown/prototype
names, absence of source declaration reads, index replacement on successful
additions, and unchanged owner/descriptor/data after rejected additions. Public
registration tests cover authored and enriched misplaced polymorphic options.
See [verification](verification-progress.md) and the
[migration note](../GUIDE/MIGRATING_API_V2.md#compiled-relationship-lookup-and-polymorphic-declaration-location).
Other consumers that need backing field names still have explicit field scans;
this change does not claim to eliminate every relationship traversal.

### Request contracts consume the compiled indexes

Writable attribute contracts exclude the existing `foreignKeyFields` set rather
than deriving polymorphic backing-field membership again. Relationship contracts
iterate `outputRelationships` once instead of separately scanning stored aliases
and declared relationships and assembling the same nested data validator twice.
The shared cardinality/type rules cover both kinds. Belongs-to allowed types use
`belongsTo` before optional `target` metadata, matching relationship execution.

Contracts still copy attribute validation definitions to create their operation
schemas and transport schemas; this is required contract construction, not a
per-record schema cache. The existing contract cache retains one variant and is
unchanged. This refactor removes repeated derivation when that contract variant
is built or replaced, not on every cached request. No new performance timing or
query-count improvement is claimed.

The metadata-cache suite verifies contract construction without reading declared
relationships, valid ordinary/polymorphic linkage, nulls, cardinality/type errors,
and belongs-to target precedence using a synthetic compiled-index variant.
Existing enrichment tests cover new aliases and connector schemas after additions.
See the [migration note](../GUIDE/MIGRATING_API_V2.md#request-contracts-reuse-compiled-relationship-metadata).

## Metadata authority audit: remaining plugin boundaries

The follow-up source audit is `/tmp/library-metadata-authority-audit.txt`.
Compiler input reads and projection enrichment legitimately consume authored
options before publication. Relationship validation also runs before compilation.
These are not request-time raw-schema fallbacks. Remaining consumers needing
review include:

| Consumer | Current source | Required follow-up |
| --- | --- | --- |
| Autofilter registration | Compiled schema with an authored-schema fallback; cached filter definitions retain field definitions and relationship paths | Remove fallback only after checking hook ordering; verify supported owner replacement keeps filter metadata current. |
| File handling | Raw declarations cached by scope name; existing-scope discovery uses `_scopeOptions` | Consume current compiled rules, retain storage backend identity, test enrichment, allowed declaration mutation boundaries, late installation and canonical additions. |
| Positioning registration | Raw `scopeOptions.schema`; requests use compiled fields/adapters | Check initialization against enriched declarations before claiming metadata authority. No positioning implementation change was made in this audit. |
| Scope include-limit validation | Raw relationship options after compilation | Reconcile with existing compiled include validation, including enriched definitions and runtime limits. |

A file-handling probe reproduced a mismatch in both SQLite storage modes:
compiled MIME rules remain `['image/png']`, but appending `text/plain` to the
retained authored array makes a `text/plain` upload succeed (one storage upload).
The probe accesses the underlying retained option through `_scopes`, so it is
not yet the public retained-input regression needed for acceptance. The dependency
stores a shallow copy of scope options; an explicit caller-held MIME array must
be used in the permanent regression. Artifacts are
`/tmp/library-file-metadata-probe.mjs` and `-knex.log`/`-anyapi.log`.

The same probe reports `compiled.storage !== suppliedStorage` for a plain-object
file backend. Blindly switching upload handling to that copy would change backend
identity/state and break supported method replacement. Treat backend handles as
external dependencies while snapshotting declarative MIME/size rules; verify
upload/deletion identity and existing cleanup behavior. The current production
implementation is unchanged by this audit. A5-02 remains open, and the earlier
configuration-lifetime acceptance must be extended to these file cases before
claiming comprehensive plugin coverage.

### File metadata authority and backend ownership

The permanent public regression passes a caller-held MIME array through the
shared file fixture; unlike the earlier probe, it does not access private scope
options. Before the fix, all four ordinary-mode cases failed: backend identity,
retained MIME-array mutation, schema-enriched MIME rules and late installation.

File handling now discovers stored file fields from `schemaInfo.schemaStructure`
and keys its existing field-list cache by the compiled owner using a WeakMap.
Both populated and empty lists refresh when supported compilation publishes a new
owner. Failed additions retain the owner and cached rules. This replaces the raw
scope-name cache and removes `_scopeOptions` discovery and the registration hook;
no additional cache or authored-schema fallback is retained.

Declaration snapshotting preserves `storage` handles on `type: 'file'` definitions
when they expose `upload()`, while copying MIME arrays and ordinary column-mapping
objects. This preserves plain-object backend identity, state, receivers and
method replacement. Existing upload cleanup/transaction tests remain required;
backend handles are intentionally not immutable declaration data.

Public tests cover enriched and caller-held MIME rules, backend identity, late
installation, committed additions, empty-cache replacement, and failed-addition
retention. A helper regression distinguishes backend handles from column mappings.
This extends the earlier configuration-lifetime acceptance to file handling.
Autofilter, positioning initialization and include-limit audit follow-ups remain
open; A5-02 is not yet complete.

### Autofilter metadata publishes with the compiled owner

Two public canonical regressions reproduced stale autofilter state: after an
enriched alias change, writes still stamped the old relationship name and failed
request validation; removing an autofilter field allowed an invalid candidate to
commit. Refreshing only on the next request would detect the latter too late.

The compiler now invokes one `schema:compiled` hook after constructing all core
facts and before taking the existing publication snapshot. Autofilter derives its
configuration there and attaches it to the candidate's `autofilter` key. Every
runtime consumer and inspection helper reads that key from the current owner.
The separate scope-variable metadata and authored-schema fallback are removed;
no extra cache, variant key or invalidation mechanism is introduced.

The hook is for deriving plugin metadata from read-only core facts. Existing
enrichment hooks remain the place to alter declarations. All handlers must succeed
before publication. The existing snapshot preserves aliases between filter field
definitions and compiled fields, detaches retained candidate metadata, and retains
callback identity. Canonical compilation failure leaves the published owner and
persisted field configuration intact. Descriptor-only refresh preserves definitions
and their derived facts without rerunning the compiler hook.

Tests cover alias-sensitive writes and resolver metadata after replacement,
invalid-candidate rejection and retained descriptor state, and candidate snapshot
isolation with identity of published field-definition aliases. Public autofilter
inspection API shapes are unchanged. See the
[new hook and migration note](../GUIDE/MIGRATING_API_V2.md#new-compiler-hook-schemacompiled).
Positioning and include-limit initialization remain under the metadata audit.

### Include validation consumes the compiled candidate

The former registration checks split responsibility: `validateIncludeConfigurations`
read compiled relationships before resource-specific limit variables were applied,
while `turnScopeInitIntoVars` reread authored relationships afterward. Seven public
regressions reproduce wrong override precedence, missed enriched violations and
invalid numeric/sort declarations accepted at registration.

One validator now runs in `schema:compiled` and reads `outputRelationships` plus
the effective declared maximum. The duplicate raw-options loop is removed. It
checks explicit numeric limit shape and sort-entry syntax with existing sort
helpers; target-field and database capability checks remain in query preparation.
Supported zero/null/false limit cases are covered, as is invalid canonical
candidate rejection preserving the previous owner, descriptor and stored data.

This removes the include-limit initialization boundary from the metadata audit.
Positioning initialization remains to review. The deep helper's named export and
compiler context are documented in the migration guide.

### Enrichment visibility uses the compiled output map

`enrichAttributes` now passes the existing `schemaInfo.outputFields` to hidden
field filtering. It previously merged stored, projected and computed definitions
into a new object for every represented resource. The compiler already supplies
that membership and validates the declaration namespaces, so the extra map had
no independent responsibility. This change adds no cache or metadata view and
leaves initialization unchanged.

A regression calls the enrichment method with real compiled fixture definitions,
counts source-map enumerations, and checks stored/projected/computed output plus
hidden and explicitly requested normally-hidden fields. Two enrichments previously
performed four stored-map, two computed-map and two projection-map enumerations;
they now perform two stored-map enumerations for the separate virtual-field
selection, with zero computed/projection enumerations for visibility filtering.
The compiled output map retains identity. Output assertions pass before and after;
the regression fails on the old source specifically for the repeated metadata
work. This is removal of three full-map enumerations and one merged dictionary
allocation per represented resource, not a wall-clock performance guarantee.

The broader authority audit still includes the paused positioning initialization
and consumer work; this change alone does not close A5-02/A5-03/A5-12.

### Sparse computed selection uses direct compiled lookup

`getRequestedComputedFields` previously enumerated every compiled computed
definition and built a visible-name array even when the request selected one
field. It now checks requested names directly in that same compiled map. An
own-property check excludes inherited names; hidden fields remain excluded,
explicit normally-hidden fields remain eligible, and request order/duplicates
remain unchanged. Default selection still enumerates declarations in their
existing order and excludes normally-hidden fields.

The measured two-name request (one present, one missing) against 200 definitions
changes from one map enumeration and 200 definition reads to zero enumerations
and one definition read. The output assertion passes on both implementations;
the work-count assertion fails before the change. Initialization and retained
metadata are unchanged: no new index or cache is needed. This is a deterministic
helper-work measurement, not a wall-clock or SQL performance claim.
