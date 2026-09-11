# Optimistic concurrency implementation review

B3 implementation and behavioral acceptance are complete through B3-10.
Stored revision conditions cover direct, relationship and supported bulk writes;
opt-in HTTP validators cover selected GET/HEAD representations and registered
resource PUT/PATCH/DELETE. Public declaration work remains under B3-11, and
coordinated consumer migration is paused. See the
[current acceptance record](verification-progress.md#2026-09-11-http-validator-acceptance-b3-06)
and [migration guide](../GUIDE/MIGRATING_API_V2.md#opt-in-http-representation-conditions).
The checkpoints below preserve the implementation history; earlier statements
that a component is unfinished describe that checkpoint, not current acceptance.

## Existing implementation boundaries

The resource PATCH method validates and authorizes the current minimal record,
runs before-data hooks, applies setters, then invokes `helpers.dataPatch` before
successful-write hooks and relationship updates. Ordinary attribute-only PATCH
does not take the relationship-parent lock. A version read in an earlier hook
therefore cannot stand in for a database write condition.

Ordinary `dataPatch` currently checks existence, maps attributes to physical
columns and updates by ID. Canonical `dataPatch` updates by logical ID, resource
and tenant, returning the affected-row count. Their declared return contracts
differ. Conditional updates need to inspect affected rows at the storage owner
without making the core guess backend return shapes. Empty attribute updates
currently skip SQL; a versioned relationship-only write needs an actual atomic
condition too.

Ordinary DELETE checks existence then deletes by ID. Canonical DELETE uses the
logical-ID/resource/tenant predicate. PUT has separate create and update paths.
All these paths must participate; implementing only PATCH would leave other
writers able to bypass version invalidation.

The existing relationship-parent helper uses a database write/lock within the
operation transaction. Reuse its ownership model where needed, while keeping a
conditional version predicate in the actual mutation. Current permissions and
tenant predicates must still apply, and a stale condition must not reveal an
otherwise inaccessible row.

Before B3 implementation, the source inventory found no `expectedVersion`, `versionField`, `If-Match`,
ETag or precondition implementation in maintained `lib`, `plugins` or tests.
Relevant owners are the existing resource methods, both storage plugins,
compiled field mappings, bulk/relationship methods and connector core.

## Selected storage direction and remaining contract decisions

The selected direction is an explicit resource `versionField` storing an opaque
revision token and an `expectedVersion` write argument. Fresh UUID tokens avoid numeric overflow and revision reuse
after deletion/recreation, without requiring a new canonical numeric slot type. Versioning needs deliberate stored data and
application participation; omission of the write condition must remain possible.
An enabled resource must still advance its version on unconditional writes.

The alternatives considered were numeric counters and opaque revision tokens. A counter needs an explicit safe range, overflow behavior and a
policy for deletion/recreation of the same ID. A fresh opaque token avoids a
numeric increment but changes the representation and migration requirements.
Canonical numeric slots are declared as SQL double columns in
`anyapi/schema-utils.js`; integer schema types use those same slots. A counter
therefore cannot assume arbitrary-precision integer storage in both modes.
Neither option should require a second metadata cache or a generic storage layer.
Direct writes reject a submitted version attribute. Initialization prepares a
UUID before schema validation, and the locally held token is restored after
setters before storage so hooks cannot replace it through the input record. Compilation now requires an existing stored string
attribute, distinct from the primary ID, with no getter, setter, storage
serializer, computed/virtual behavior or relationship. Its existing hidden-field
policy is preserved; compilation does not add a field or change visibility.

Specify POST initialization, PUT-create, no-op PATCH, deletion, each bulk child,
relationship-only writes, inverse relationship effects, rollback, and repeated
writes in one transaction. Distinguish the directly mutated resource's revision
from all data observable through includes, getters, policies and computed fields.
Raw SQL writers must participate in the chosen invalidation contract; the
library cannot infer their effects after they bypass it.

Migration guidance must describe an explicit stored field and backfill, readiness
checks and consumer retrieval/submission of the version. Configuration alone
must not alter application tables or silently expose a hidden version field.

## HTTP representation constraints

### Selected If-Match handling

`httpValidators` defaults to false. With it enabled, the connector applies this
contract to GET/HEAD and registered resource PUT/PATCH/DELETE:

| Header | Behavior |
| --- | --- |
| Absent | No representation precondition is imposed. |
| One strong tag | Compare the selected representation exactly. |
| A list or repeated field lines | Any matching strong tag satisfies the condition. Bounded empty list members are ignored. |
| Only weak tags | Cannot satisfy If-Match. |
| Empty header/list | Does not match; distinct from an absent header. |
| `*` alone | Requires an existing visible representation. |
| Mixed wildcard/list, malformed or oversized input | Validation error, HTTP 422. |

A failed comparison returns 412 with `REST_API_PRECONDITION_FAILED`, without
returning the current tag. A missing GET/HEAD/PATCH/DELETE retains its normal 404;
conditional PUT cannot create a missing target. Actual transaction conflicts
remain native failures rather than silently retried operations.

Normal request errors take precedence over comparison. In particular, a PUT
target rejected as hidden during the existing resource checks retains its 404.
A genuinely missing target that otherwise permits PUT-create fails If-Match
with 412. These PUT outcomes are intentionally distinct; the HTTP option does
not promise to conceal existence across requests that have different normal
authorization/existence outcomes. No current representation or token is returned
by a failed comparison. The direct `expectedVersion` API keeps its own documented
hidden/missing error contract.

OPTIONS, CONNECT and TRACE ignore If-Match, even when malformed, because those
methods do not select or modify a representation. Other routes currently reject
If-Match with 422 and `If-Match is not supported for this route`; this includes
collection POST and relationship mutation endpoints. Their unconditional calls
and body-level revision contracts are unaffected. This follows the method
exclusions in [RFC 9110 section 13.2.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.2.1).

Real connector tests cover unconditional POST/PATCH/PUT/DELETE with the option
enabled, and conditional rejection before mutation on unsupported routes.
Parser bounds remain 8,192 header characters and 128 tags/field lines/separators.
This handling contract does not establish completion of the broader rendering,
dependency, hook or public-type work.

RFC 9110 requires strong comparison for `If-Match`; a strong validator changes
with observable representation data. A row counter cannot automatically provide
that guarantee for includes, computed fields, response hooks or format variants.
See [validator strength](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.1)
and [If-Match](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.1).

The HTTP design must specify how the selected representation and its dependencies
are checked consistently with the mutation. Hashing one earlier GET and then
updating later leaves an interval to examine for concurrent dependency changes.
Do not label a row token a strong ETag without proving the invalidation contract.
Account for resource recreation and representation variants as well.

Tests must cover absent conditions, wildcard existence, lists, weak validators,
malformed syntax and failure before mutation. Successful PUT responses also need
review: [RFC 9110 section 9.3.4](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.3.4)
restricts sending validators when the submitted representation was transformed.
The library applies normalization, defaults and setters, so unconditional ETag
emission after PUT would not be justified.

### Serializable transaction foundation

An internal symbol on the transaction owner's context now requests serializable
isolation through the existing Knex transaction factory. PostgreSQL/MySQL receive
the isolation setting when the transaction begins; SQLite retains its native
serializable transaction behavior. The symbol is not a root public export or an
HTTP argument. Ordinary transactions retain their current database defaults.

A two-connection test reads a collection in both transactions, then each consumes
a different available record based on that earlier representation. Without the
new isolation request PostgreSQL lets both commit. With it, exactly one commits
on every supported database/storage combination. This establishes a database
foundation for representation-dependent writes; strong resource ETag writes now
use it as described below. It cannot make external services or getters using another connection
part of the transaction snapshot. Deadlocks, serialization failures and SQLite
busy errors must remain failed operations; no automatic retry is introduced.

## First implementation evidence required

### HTTP grammar implementation checkpoint

The connector-local `http-validators.js` now parses optional If-Match field
values and performs strong comparison. It accepts repeated field lines, bounded
empty list elements, empty opaque tags, embedded commas and literal backslashes.
Weak tags cannot match; wildcard requires existence and cannot mix with a list.
Absent conditions are unconditional; an empty tag list never matches. Input is
bounded to 8,192 characters, 128 tags/field lines and 128 separators. Malformed
syntax uses a validation error without echoing the header.

The grammar follows [If-Match](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.1),
[entity tags](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3) and
[list recipient rules](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.1.2).
All 24 focused Node 24 parser/comparison tests pass. This helper is not yet wired
to routes; no HTTP ETag emission or conditional-request support is claimed.
Representation selection, transaction integration and connector acceptance remain
open under B3-06/B3-07.

### Serialized representation boundary

Both connectors currently hand response objects to framework serializers:
Express calls `json`, while Fastify calls `send`. A validator computed earlier
from an independently serialized object would not establish that it identifies
the emitted bytes. The shared validator helper now accepts only a serialized
string or Buffer and hashes those bytes with content type and content encoding.
It does not invoke object serialization or `toJSON`. The intended opted-in
connector path must serialize once and send those same bytes; middleware that
subsequently transforms the representation must maintain its validator too.

The 28-test helper suite covers equal UTF-8 string/Buffer values, byte-layout and
format changes, included/computed output changes with an unchanged row revision,
and content metadata variants. Hashing addresses representation identity only.
Before enabling emission, conditional requests still need equivalent selected
representation reads, transaction/locking integration and real connector tests.
A GET hash followed by an independent write is not sufficient. Successful PUT
validator restrictions and response-hook behavior remain part of that review.

### Connector emission implementation checkpoint

The in-progress `httpValidators: true` connector option now serializes successful
GET responses once after the transport response hook, hashes those bytes and
sends them directly in Express/Fastify. This opts out of framework JSON layout,
Express replacer/escaping settings and Fastify custom JSON serializers for those
responses; the actual emitted bytes define the validator. Required body
transformations belong before serialization, in resource output or response
hooks. The [HTTP migration section](../GUIDE/MIGRATING_API_V2.md#opt-in-http-representation-conditions)
includes connector setup, a conditional browser write and explicit CORS headers.
GET includes and response-hook changes affect the hash. Express's automatic PUT
ETag is suppressed in this mode; the new path emits no PUT validator. External
middleware that transforms bytes or encoding remains responsible for updating
the validator.

This is not yet a complete conditional-write API. Opted-in GET requests now
compare their selected representation against If-Match. Strong matching lists
and wildcard conditions succeed; weak, nonmatching and empty lists produce 412
with `REST_API_PRECONDITION_FAILED`. Missing resources retain normal 404 errors,
and malformed conditions produce 422. The focused GET/helper/Express 4 selection
passes 70 checks. Resource PUT/PATCH/DELETE now support wildcard and strong-tag
conditions as described below. Other non-GET conditions still fail validation
before the resource handler (422).
The option defaults off. Current evidence is 380 connector/parity checks across
both storage modes, eight additional Express 4 checks, typecheck and scoped lint.
B3-06/B3-07 stay open.

Registered resource handlers now accept a connector-supplied transaction handle
and forward it into existing resource methods. It is not taken from the body,
headers or query string. Four real route-handler tests pass in each of six native
database/storage combinations: PATCH/PUT/DELETE remain provisional, subsequent
GET/query reads share the transaction, caller rollback restores the row, and
POST commits with its owner. Typecheck and scoped lint pass. This establishes
transaction forwarding, not atomic HTTP representation comparison. Parent locks,
dependency consistency and permission/response-hook context still need integration.

### Wildcard resource writes

Opted-in resource PUT/PATCH/DELETE with `If-Match: *` now use `api.transaction`.
A normal resource GET checks visibility using a separate operation context and
the same transaction. The existing relationship-parent lock then holds the row
through the registered write handler and transaction completion. The condition
adds a read-permission requirement; write permissions still run normally. PUT
against a missing target fails with 412 instead of creating it (the later
normal-error precedence correction retains 404 for an already-rejected hidden target);
PATCH/DELETE retain their normal not-found response. Unconditional requests keep
their existing path. This does not compare representation bytes.

Write-hook failure rolls back mutation and reports `rolledBack` through the
existing HTTP error contract. The combined wildcard/GET and route transaction
suites pass 180 native checks (30 per database/storage combination), plus 26
Express 4 checks. Scoped lint and typecheck pass. The first test run exposed a
test response hook assuming every successful response has a body; it now handles
DELETE's empty response. B3-06/B3-07 remain open.

The subsequent visibility/deletion selection passes 228 native checks and 38
Express 4 checks. SQL row-policy-hidden and subsequently deleted targets have
identical error responses at the same ID. A separate connection commits deletion
after the existence read and before the row lock; conditional writes never
recreate that target. PUT's lock-time not-found error now becomes 412, matching
its initial missing-target case. PATCH/DELETE retain 404 on PostgreSQL/MySQL.
SQLite rejects the stale read transaction's write attempt with its native lock
error (HTTP 500), not a normalized precondition failure. Full strong-tag
acceptance and representation dependency review remain unfinished.

### Strong resource write integration checkpoint

Opted-in resource PUT/PATCH/DELETE now select the GET representation inside a
serializable managed transaction. They retain the request's include/fieldset
query, use normal GET visibility checks and hold the existing parent row lock
through comparison and mutation. The response hook runs on a separate context
with `precondition: true` and normalized request method GET. The selected body
is serialized and hashed with the same helpers used by actual GET responses.
The registered writer validates and authorizes the operation before invoking a
trusted internal precondition callback; only a matching strong tag permits the
mutation to proceed. Weak tags cannot match; empty lists and changed representation
variants fail with 412. Wildcards retain the existence-only path.

This opt-in mode renders a speculative GET view before the actual write
response. Response hooks and computed fields used for that view must produce
deterministic representation data and avoid external effects. The native
`raw` request/reply still belong to the actual HTTP request; normalized request
metadata describes the selected GET view. Database-dependent rendering must use
the supplied transaction. Arbitrary external reads are not made transactional by
enabling this option. These hook/context boundaries still need final review and
public documentation before feature completion.

Initial integration passes 372 native checks (62 per combination), including
strong lists, weak/empty conditions, includes, response-hook variants and write
rollback. A subsequent two-request barrier test passes 12 native checks: both
clients read the same representation, exactly one PATCH commits, and a later GET
matches the winning response with a changed ETag. The losing concurrent request
currently returns its native transaction failure (HTTP 500); no automatic retry
or normalized 412 is claimed. Express 4 adds 64 checks. Typecheck and scoped lint
pass. Authorization/error precedence, HEAD handling, broader dependency races,
public types and final hook/computed-field acceptance remain open.

### HEAD and write-check ordering

HEAD now shares GET's serialization, validator and precondition path. Frameworks
suppress the response body; matching/wildcard HEAD returns 200, stale conditions
return 412 and missing targets retain 404. Response renderers must describe the
same selected representation for GET and HEAD. The fixture's method-dependent
metadata now follows that rule; actual transport request metadata remains HEAD.

The connector supplies its precondition callback directly to the registered
resource handler, which forwards it through a private symbol. PATCH/PUT/DELETE
invoke it after document validation and their existing permission checks, before
mutation hooks and storage changes. No second permission implementation is added.
Denied writes with stale tags now return 403; mismatched document IDs return 422.
The initial PUT hidden-target branch also invoked the callback to return 412.
The later protocol review removed that exception: an already-detected hidden
target keeps its normal 404; only an otherwise admissible missing-target
creation reaches the condition and returns 412. Regression tests compare hidden
conditional responses with the same unconditional request's full error body.

This follows the normal-check ordering reviewed in
[RFC 9110 section 13.2.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.2.1).
The initial permission regression failed six checks with 412 instead of 403.
After the callback change, the HTTP, direct version-write and route-transaction
selection passes 552 native checks (92 per database/storage combination), plus
76 Express 4 checks. Typecheck and scoped lint pass. This does not complete the
remaining method combinations, rendering contract or all error-precedence cases.

### Speculative rendering failure and header isolation

A speculative response-hook failure rolls back provisional child writes and
leaves the parent unchanged. The actual error response runs its own response
hook once, with PATCH metadata; the failed speculative view retains GET metadata
and cannot leak its response headers into that error response.

The stronger regression found shared request headers: mutating the speculative
view's header map changed the actual response hook's input. The selected GET view
now copies normalized request headers, including repeated-value arrays, through
a helper in the existing request-helpers module. Actual request method/header
metadata remains intact after the failed render. Native request/reply references
and application context objects still belong to the original request; rendering
callbacks must keep external effects outside this speculative phase.

Failure isolation plus the simultaneous-client control pass 24 native checks,
with two additional Express 4 checks. Fourteen helper cases cover header-array
copying and response-body selection. Typecheck and scoped lint pass.

### Database-backed computed representation acceptance

The HTTP fixture now includes an explicitly requested computed field that queries
related child names. Its query borrows `context.transaction` and uses a fresh
operation context preserving the caller's authorization data. A committed child
change invalidates the parent's computed ETag even though the parent itself did
not change. Refreshing the selected representation permits a later write.

A second case changes the child provisionally inside the conditional write's
transaction. The computation observes that uncommitted value, rejects the old
tag, and rollback restores both child and parent. A third case restricts child
visibility: computed output excludes hidden rows and the representation's tag
reflects that visible output. Tags from the unrestricted view fail under the
restricted context, while a matching restricted tag succeeds.

These three cases pass in both HTTP connectors across all six native
database/storage combinations (36 checks), plus six Express 4 checks. This
establishes the supported transaction/context pattern for database-backed
computation. Callbacks still own any external reads and effects; the library
cannot include another connection or external service in its snapshot.

### Response replacement selection

Successful and error responses now use the body selected by `transport:response`,
including replacement objects, explicit null and an explicitly cleared body.
Previously only in-place mutations of the original result reached the client.
Strong write comparison also selects the speculative response hook's final body,
so replacement metadata changes invalidate an earlier ETag. Matching replacement
views allow the write, and its actual response uses the hook's replacement too.

A successful empty GET can satisfy `If-Match: *` even when no body is serialized
and no ETag is emitted. Strong-tag comparisons still require a matching tag.
This separates resource/representation existence from the presence of JSON bytes.

The response replacement, HTTP validator and connector parity selections pass
282 checks in each storage mode. Express 4 verifies the replacement regression
in both modes. A final 44-case helper selection covers object/null/cleared success
and error replacements, bodyless wildcard handling and validator grammar.
Typecheck and scoped lint pass. This fixes response selection; it does not close
the remaining computed-field, dependency or speculative-hook contract review.

### Handler completion check

Before committing a conditional request, the connector now verifies that its
precondition callback completed successfully. A resource handler that drops the
callback causes a validation failure and rollback of the managed transaction.
The regression uses a custom registered handler that performs a real resource
PATCH with the supplied transaction but omits the callback: both connectors
previously committed that stale request. The corrected path restores the record
and reports HTTP 422 with a rolled-back outcome.

The omitted-callback, matching-write and simultaneous-client selection passes
60 native checks and ten Express 4 checks. Typecheck and scoped lint pass.
Custom handler composition remains responsible for awaiting the callback before
mutation and borrowing the provided transaction. Completion checking establishes
rollback for the omitted-callback path; speculative rendering and external-effect
contracts remain part of the unfinished feature review.

Start with a selected stored representation and a real shared resource fixture.
Prove a stale condition cannot overwrite a newer value and that unconditional
writes invalidate older conditions. Extend the same atomic behavior across PUT,
DELETE, relationships and bulk before claiming the resource contract complete.
Then prove two genuine concurrent clients, authorization/non-disclosure,
rollback, upload cleanup and notification behavior on both storage modes and
real databases. HTTP validators and public declarations need their own complete
integration, not parser-only evidence.


## Atomic storage primitive in progress

`writing/resource-version.js` now reuses the existing storage adapter to update
the mapped version column with a fresh UUID, adding the expected-token predicate
when supplied. It requires the operation transaction and is intended to run
after authorization. Canonical base queries retain their tenant/resource scope.
Seven storage-level cases pass in each SQLite storage mode: matching/stale
conditions, unconditional rotation, rollback and malformed arguments.

The helper now participates in direct resource writes: creation initializes a
token, existing writes conditionally rotate it, and the attribute mutation shares
the operation transaction. Unconditional direct updates still rotate the token;
conditional creation fails. Relationship/bulk participation, complete
authorization/error classification and HTTP integration remain required. The condition now compares binary values on SQLite/MySQL and UTF-8 bytes on
PostgreSQL, independent of column collation. A real MySQL regression showed
that ordinary string equality accepted a trailing space in the expected token.
The corrected nine-case storage suite passed both modes on all three databases
(54 checks). Other database clients have no conditional-revision implementation
unless explicitly handled; aliases using the same SQL remain unverified.
The expanded ten-case matrix passes all six combinations (60 checks). Two
transactions acquire connections and meet at a barrier before attempting the
same expected-token update; exactly one succeeds and its token remains stored.
The SQLite assertion allows its native busy rejection as well as a version
conflict. This verifies the storage primitive, not public write-method behavior.


## Direct method contract

Declare a stored string field explicitly and select it with `versionField`.
`expectedVersion` is optional on PATCH, PUT-update and DELETE. POST rejects it;
PUT-create with a condition fails because no existing revision can match.
Conditions must be non-empty strings of at most 128 characters. Supplying one
on an unversioned resource is a validation error. The generated token uses a
UUID and retains the field's declared output visibility in both formats.

```javascript
// Resource declaration fragment
{
  schema: { name: { type: 'string' }, revision: { type: 'string' } },
  versionField: 'revision'
}

const updated = await api.resources.items.patch({
  id: current.id,
  inputRecord: { name: 'Updated' },
  format: 'plain',
  returning: 'full',
  expectedVersion: current.revision
})
```

Read the revision from the selected response; do not include it among submitted
attributes. Minimal/none responses do not promise to return the new token; use a
full response or a subsequent read. Existing data requires an explicit migration
and backfill; the [migration guide](../GUIDE/version-field-migration.md) and executable
example now verify that workflow on all three databases and both storage modes. These tokens are not HTTP
ETags. No If-Match handling is provided by this direct-method implementation.

The configuration, primitive and direct-method selection passes 30 checks in
each of six native driver/storage combinations (180 total). Public cases cover
both response formats, required revision initialization, stale PATCH/DELETE,
unconditional PUT, conditional creation failure, caller input ownership, hook
mutation and rollback after a failing write hook. Public concurrent PATCH operations are now also verified below; permissions
and relationship/bulk interactions still require their own tests.


## Public concurrent PATCH acceptance

The direct-method fixture uses separate pooled connections and a before-data
barrier. Two calls with the same revision overlap before their mutation. One
succeeds, one fails, only one after-data hook runs, and the final resource matches
the winning response. Both formats pass on SQLite/PostgreSQL/MySQL in both
storage modes (60 direct-method checks total). SQLite may return its native busy
error; the other two drivers return a version conflict.

Removing only the SQL version predicate through an isolated test loader makes
both PostgreSQL race cases fail with two successful writes. Sequential stale
PATCH/DELETE assertions also fail. This mutation is not part of runtime code.
B3-09 is complete; these checks do not establish the unfinished relationship,
bulk, authorization, upload/notification or HTTP validator contracts.


## Relationship endpoint conditions

`patchRelationship` now forwards `expectedVersion` into its existing resource
PATCH composition. `postRelationship` and `deleteRelationship` apply the same
atomic parent revision check in their existing transaction after locating the
visible parent. A version update already locks the row; the former parent-lock
helper remains in use for unversioned resources.

Matching calls rotate the parent revision. Stale calls reject without changing
the final membership or revision. Has-many and many-to-many cases pass for all
three relationship methods in both modes on SQLite/PostgreSQL/MySQL (36 checks).
The original three has-many regressions fail before the change. These are parent
endpoint guarantees; inverse changes through other resources, polymorphic
relationships, bulk conditions and the complete invalidation policy still need
explicit acceptance before the whole concurrency feature is complete.


## Conflict errors and visibility

A visible stale revision raises the exported `RestApiVersionConflictError`,
with code `REST_API_VERSION_CONFLICT` and subtype `conflict`. Resource write
wrappers retain that error as their cause, copy its code, and report transaction
outcome normally. The HTTP error mapper emits status 409 and the same stable
code, without either the expected or current revision value. This does not add
If-Match parsing or turn revision tokens into ETags.

A hidden target is checked through the existing visible-record path before the
version predicate. Missing targets remain not-found errors too. In particular,
conditional PUT-create now returns not found: returning a version conflict there
previously distinguished a missing row from a policy-hidden row at the same ID.
Twelve direct/relationship error cases verify visible conflict identity,
rollback, protected revision values and identical hidden/missing HTTP mappings.
The error, direct-write and relationship selection passes 28 checks in each of
six native driver/storage combinations (168 total).

## Bulk condition contract

The existing bulk PATCH `operations` and bulk DELETE `ids` shapes remain.
Both accept an optional `expectedVersions` array with exactly one token per
entry. This keeps the condition argument the same across the two methods.
Omitting the array selects unconditional writes; mixed conditional/unconditional
entries are not supported. Singular `expectedVersion` is rejected on bulk calls,
and bulk POST rejects either condition option. Conditions on an unversioned
resource, malformed tokens, sparse arrays and mismatched lengths are rejected
before child work, including when `atomic` is false.

The plugin copies validated tokens and forwards each through the existing
single-write API; it introduces no second mutation path. Atomic failures roll
back the owned transaction; non-atomic failures retain successful children and
report the failed index, stable error code and transaction outcome. A supplied
managed transaction remains caller-owned. Repeating an ID does not reuse a
revision: the second PATCH is stale, and the second DELETE sees a missing row.

HTTP bulk request bodies forward the same array. This is body-level revision
checking, not `If-Match` support. See the
[bulk guide](../GUIDE/GUIDE_X_Bulk_Operations.md#version-conditions) for a call
example and response behavior. Whole-feature invalidation, side effects,
public types and HTTP validator acceptance remain open.


## Version migration acceptance

B3-03 is complete. The [migration guide](../GUIDE/version-field-migration.md) describes
explicit field allocation and output visibility, paused-writer backfill,
per-row UUIDs, retry and rollback, canonical tenant/resource scoping and restart.
The executable example plus allocation/restart tests pass six checks in each
native driver/storage combination (36 total). Application tables and consumer
repositories are not altered by selecting configuration or writing this guide.


## Inverse reference invalidation

Direct POST/PUT/PATCH/DELETE now capture stored references for configured
versioned parents with has-many/has-one relationships, including reverse
polymorphic `via` relationships. Existing child references are read under the
write transaction's row lock after authorization. After the storage mutation,
the helper compares stored old/new references and rotates each affected parent
revision in that same transaction. It uses existing adapters, including their
canonical tenant/resource constraints, and adds no successful-write hooks to
parent metadata updates. Missing old parents require no update.

A parent revision changes when a child is created, moved, detached or deleted.
Attribute-only child changes do not rotate parent revisions when membership
stays the same. This is a linkage guarantee, not a strong validator for included
child attributes or arbitrary computed output. A caller rollback restores the
child write and parent revisions together. No SQL is added for resources with
no configured versioned inverse parent.

The three original inverse regressions fail before this change. Expanded inverse,
direct-write, relationship endpoint and conflict-error selections pass 33 checks
in each of six native database/storage combinations (198 total), with no failures
or skips. Tests include ordinary and polymorphic references, PUT-create/update,
rollback and stale parent membership replacement. Relationship endpoint setup now
reads the current parent token after seeding linked children, since that seeding
correctly invalidates the original token.

Many-to-many link writers, pivot resources, database cascades, broader concurrent
reference changes and complete invalidation acceptance remain open. B3-02 is not
yet complete; the helpers above do not claim to cover those remaining paths.


## Many-to-many inverse invalidation

Ordinary pivot writers and canonical link writers now invalidate configured
versioned inverse resources for attachment, replacement and removal. The
relationship processor preserves the target resource name needed by ordinary
storage; endpoint POST also passes the complete relationship definition.

Removed-link reads use bounded pages. Inverse revision updates use batches of
at most 100 IDs and a CASE expression assigning a fresh UUID to each affected
row. The adapter retains canonical tenant/resource predicates. Addition and
replacement may also rotate revisions for explicitly retained targets; tokens
are change signals, not operation counters. Unrelated rows are not invalidated.

The version metadata update shares the link mutation's transaction. Low-level
link writers that would maintain versioned inverse metadata reject an absent
or completed transaction before mutation, including empty replacement lists.
Public resource methods already provide that transaction. These internal link
helpers are not substitutes for public resource authorization or conditional
write calls.

The original six new many-to-many cases fail before the change. After adding
batching and low-level transaction checks, inverse/relationship selections pass
19 tests per native database/storage combination (114 total), with no failures
or skips. The 205-member case verifies three bounded revision-update statements,
per-row token uniqueness, rollback after replacement, removal and an unchanged
unrelated resource. Resource POST/PATCH/PUT and all three relationship methods
are covered. Direct pivot resource writes and deletion/cascade invalidation still
need their own implementation and acceptance before B3-02 closes.


## Direct pivot-resource writes

The existing inverse-reference tracker now recognizes ordinary pivot resources
named by versioned parents' many-to-many declarations. It captures both pivot
keys: changing the related member must invalidate the parent even when the
parent key itself stays the same. POST, either-key PATCH and DELETE rotate the
relevant parent revisions within the pivot write's transaction. Caller rollback
restores both the pivot row and its parent revision.

Canonical through-resource records are separate from canonical links. Creating
one does not change the relationship membership and does not invalidate that
relationship's parent revision. Canonical applications use the relationship
methods to change canonical membership; this change does not reinterpret
through-resource CRUD as link operations.

The expanded inverse suite passes 14 checks in each native database/storage
combination (84 total). A subsequent focused selection verifies ordinary pivot
delete rollback and the canonical distinction on all six combinations (6 more
checks). Source-resource deletion and cascade effects remain open under B3-02.

## Deleting a many-to-many member

Public resource deletion now locks the source and captures incoming links to
versioned parents before deleting it. Existing bounded link scans and revision
updates invalidate those parents in the same transaction. After the resource
delete succeeds, remaining declared ordinary pivot references or scoped
canonical links are deleted. Reusing the deleted ID cannot resurrect those
memberships. Caller rollback restores the source, links and revisions together.

The inverse and versioned-relationship suites pass 126 native checks (21 per
database/storage combination), including the deleted-ID recreation regression
and rollback. Explicit SQL constraint/cascade behavior, transitive cascades,
unversioned cleanup scope and broader concurrent deletion still need separate
acceptance; this does not close B3-02 or establish whole-suite verification.
