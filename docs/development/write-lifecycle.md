# Write lifecycle and simplification boundaries

This records the selected resource lifecycle and verified bulk composition.
Positioning and consumer work are paused. The managed transaction contract, file/event integration and selected
relationship/bulk composition traces are verified. Consumer hook inventory and the broader extension audit remain open. See [managed transactions](../GUIDE/managed-transactions.md)
and [transaction outcomes](../GUIDE/transaction-outcomes.md) for completion semantics.

## Selected resource contract

The resource method files show operation order. Shared mechanics have narrower
owners:

| Responsibility | Owner |
| --- | --- |
| PUT/PATCH document validation and path/body ID agreement | `querying-writing/request-contracts.js`: `validateUpdateRequest` |
| ID normalization and invalid-ID errors | `querying-writing/resource-id-normalization.js` |
| Parent and target row locking | `writing/relationship-processor.js` |
| Relationship membership changes | `writing/many-to-many-manipulations.js` and `writing/reverse-relationship-manipulations.js` |
| Revision updates and inverse invalidation | `writing/resource-version.js` |
| Transaction ownership and completion | `lib/error-context.js` and `lib/knex-transaction.js` at the package root |
| Shared resource setup, validation, setters and write response preparation | `rest-api-plugin-methods/common.js` |

Paths above are relative to `plugins/core/lib/` unless stated otherwise;
`rest-api-plugin-methods/common.js` is relative to `plugins/core/`.
`validateUpdateRequest` updates `context.inputRecord` and `context.id`; it runs
after the processing hooks. Parent locking is also used by HTTP preconditions,
so connectors import its writing-layer owner directly.

Keep the current resource hook names and their operation-specific ordering.
They have existing consumers and changing their names would not simplify the
setter boundary identified below. Each hook and setter is awaited before the
next stage. POST, PUT-create, PUT-update and PATCH use this sequence:

1. Create or borrow the transaction; select format and returning behavior.
2. `beforeProcessing`, then the method-specific processing hook.
3. Contract/relationship validation and method-specific existence/replacement
   checks. `beforeSchemaValidate`, then its method-specific hook; validate;
   method-specific `afterSchemaValidate`, then `afterSchemaValidate`.
4. Write authorization through `checkPermissions`, followed by `beforeDataCall`
   and its method-specific hook.
5. Lock relationship targets/parents where the operation requires them; apply
   field setters; perform the operation-specific storage write.
6. Method-specific `afterDataCall`, then `afterDataCall`.
7. Apply relationship changes and refresh the minimal stored record.
8. Prepare the selected response; `finish`, then method-specific `finish`.
9. Commit only a transaction owned by this operation, then await `afterCommit`.

DELETE has no processing/schema/setter stage: existing-record lookup and
authorization precede before-data hooks; deletion precedes after-data hooks and
finish hooks. It returns no record. Its transaction ownership is the same.

For `returning: 'none'` and `'minimal'`, write response preparation does not invoke
the resource GET. For `'full'`, a nested GET uses the same transaction and a
separate context object before the write finish hooks. Its sequence is:
`checkPermissions`, `beforeData`, `beforeDataGet`, storage read,
`checkDataPermissions`, `checkDataPermissionsGet`, `enrichRecord`, field getters
and computed fields, `enrichAttributes`, `enrichRecordWithRelationships`, `finish`,
`finishGet`, final normalization/projection and representation conversion.

Authorization hooks receive the operation context as `context.originalContext`.
Attribute enrichment receives it as `context.parentContext`. Other listed
resource hooks receive the operation context directly. Nested read hooks see
`method: 'get'`; write hooks retain their own method. Auth and the transaction
retain their identities across the nested read. Input values are validated
before setters; after-data hooks see the transformed input attributes. Write
finish hooks see refreshed minimal data, and `responseRecord` holds the selected
output. POST assigns the storage result's ID before its after-data hooks; PUT
determines its create/update branch before schema validation.

An ordinary hook failure stops later stages. Owned pre-commit failures attempt
rollback; `afterRollback` runs only after acknowledged rollback. Participating
writes leave completion to their managed owner. A rejected participant poisons
the unit even if its caller catches the error. After acknowledged commit, a
later failure reports committed and does not attempt rollback. Uncertain driver
completion runs neither outcome hook; the completed flag alone proves no outcome.

The write boundary retains the error it receives as `RestApiWriteError.cause`,
with a snapshot of `transactionOutcome`. The operation context retains original
and secondary diagnostics. Hook-chain failures additionally identify their
operation, scope and method; bulk aggregation adds `bulkIndex`. Context reuse
clears error diagnostics, while unresolved file tracking remains available.
These boundaries cannot restore an error already replaced inside the installed
hook dispatcher; the [pending dependency patch](pending-hooked-api/README.md)
records that unresolved A7-05/A7-06 work.

Private ownership in `lib/error-context.js` controls commit/rollback. Resource
children in an atomic bulk batch enlist their completion chains with the batch's
owner. The bulk owner does not create a duplicate resource completion chain.
After commit, children complete in enlistment order; after rollback, in reverse
order. Later completion chains and diagnostic finalizers are attempted despite
an earlier completion failure, under the managed contract's error rules.

## Verified bulk trace composition

The composed trace suite reuses the resource stage expectations above. Each
child of bulk POST, PATCH and DELETE completes its awaited data and finish
stages before the next child starts. Child contexts are distinct; all atomic
children share one transaction. Non-atomic entries have distinct transactions
and finish their own afterCommit chain before the next entry starts.

When the batch borrows an explicit `api.transaction` handle, no child completion
hook runs before the outer callback finishes. A normally returning callback
completes children in order. If the callback rejects after a successful batch,
all child database changes roll back and afterRollback chains run in reverse
order. This is checked with exact enter/exit traces, transaction identities,
driver completion flags and final stored records for all three bulk methods.
These cases use `returning: 'none'`; individual resource traces above cover
nested GET behavior for full responses. The relationship composition below
completes the corresponding A4-03 trace coverage.

## Bulk failure-stage traces

The bulk trace suite additionally injects a typed failure into every retained
write hook/setter of the second child for POST/PATCH/DELETE, plus its afterCommit
hook. Each three-entry batch runs as owned atomic, non-atomic and explicit
managed work. Before commit, atomic failure stops subsequent child work and
rolls back both the earlier child and the failing child. Non-atomic failure
preserves the first committed child, rolls back the failing entry, and completes
the third entry. Exact traces and stored records verify both paths.

A failing afterCommit hook leaves all three mutations committed. Atomic and
managed calls reject with committed outcome; non-atomic results report two
successful calls and one error carrying committed outcome. Later enlisted
completion chains still run. This is why `meta.failed` cannot count rolled-back
mutations. The first failure remains the original cause at a rejected batch
boundary; non-atomic error entries retain classification and outcome.

These 114 cases cover A4-05's bulk failure paths. The resource phase matrix and
the relationship injections below cover the other selected lifecycle paths.

## Verified relationship trace composition

POST/DELETE relationship endpoints run their general and method-specific
permission hooks, general and method-specific before-data hooks, then their
finish hooks around the relationship mutation. Direct pivot/link changes do
not create synthetic pivot-resource lifecycle calls. Reverse relationship
changes run a normal PATCH lifecycle for each changed child between the parent
endpoint's before-data and finish hooks.

PATCH relationship runs its permission hooks, then a separate source-resource
PATCH with `returning: 'none'`, followed by the endpoint's finish hooks. The
source PATCH performs its after-data hooks before changing reverse children;
those children finish before the source PATCH's finish hooks. Replacement
removes old reverse members before attaching new ones. Clearing a reverse
relationship invokes only removal PATCHes on its children. A to-one or pivot update needs no reverse
child lifecycle. Each nested operation has its own context and shares the same
transaction. Its early PATCH processing hooks see an unset `context.id`; the
ID becomes available before schema-validation hooks, just as for direct PATCH.

| Completion | Verified sequence |
| --- | --- |
| Owned commit | Endpoint and nested operations finish their write stages; completion chains then run in enlistment order. |
| Owned finish rejection | Later write stages stop; the owner rolls back, then completion chains run in reverse enlistment order. |
| Explicit managed commit | The endpoint returns while the handle remains active, with no completion hooks yet; owner commit then completes all enlisted operations in order. |
| Explicit managed callback rejection | Endpoint and nested writes finish first; callback rejection rolls back the whole unit and completes enlisted operations in reverse order. |

The 88 relationship cases cross supported POST/PATCH/DELETE endpoints, ordinary
and inverse many-to-many, hasMany, hasOne, belongsTo, polymorphic and reverse
polymorphic relations, all four completion modes, and explicit PATCH clearing.
They assert exact awaited hook entry/exit traces, context counts, transaction
identity/completion flags, and restored or committed linkage. Together with the
bulk traces, they establish A4-03. The failure-stage matrix below extends this
contract; consumer hook inventory and migration remain separate requirements.

## Relationship failure-stage traces

The failure matrix injects at every retained endpoint or nested PATCH hook in
pivot and reverse POST/PATCH/DELETE relationship writes, plus every enlisted
afterCommit hook. Each runs with an implicit owner and an explicit managed
owner. These 244 cases reuse the same expected composition as successful
relationship traces; they do not infer expected order from captured events.

Before commit, only the expected prefix of write hooks runs. Rollback completes
only reached operations, in reverse enlistment order, and restores the initial
linkage. A reverse replacement can fail in either the old child's removal or
the new child's attachment. Repeated early processing labels are distinguished
by occurrence, so a failure in the second child does not accidentally test the
first one. A child rejected before validation retains an unset ID in its
rollback hooks, matching the resource context contract.

After commit, the failed hook stops its own chain while later operation chains
still run. The failure retains committed outcome and the changed linkage
remains. Every case checks exact awaited entry/exit, original cause, outcome,
context count, shared transaction identity, completion flags and stored linkage.
Combined with resource and bulk injection, this establishes the selected A4-05
stage coverage. Arbitrary extension throws, logger behavior and uncertain driver
completion retain their separate A7 requirements and documented limitations.

## Bulk caller ownership (A7-F01)

The bulk methods previously ignored `params.transaction`. Atomic calls created
and completed a different transaction; non-atomic children committed on their
own. This violated the caller's requested unit of work. The 24 new cases in
`conformance-bulk-failures.test.js` all fail against that source in each storage
mode.

The A7-F01 correction established borrowed bulk ownership. The current contract
requires an active `api.transaction` handle when a batch supplies a transaction;
raw Knex transactions and child savepoints cannot own library writes. Private
ownership replaces mutable completion flags. Non-atomic participation still
rejects before children execute. The table describes the current contract.

| Call | Ownership and failure behavior |
| --- | --- |
| Atomic, no supplied transaction | The batch creates/completes one transaction; child failures roll back the owned batch |
| Atomic, supplied managed transaction | Children and response reads borrow it; success remains pending and failure poisons the unit for owner rollback |
| Non-atomic, no supplied transaction | Each resource entry owns its transaction and contributes its existing success/error result |
| Non-atomic, supplied transaction | Typed validation rejects before child hooks or SQL; select atomic mode to join an outer transaction |

Borrowed bulk has no implicit savepoint. Hook rejection can leave both preceding
entries and the failing entry's writes pending. Let the rejection propagate to
the owner so it can roll back the complete unit. A driver error may additionally
abort the transaction. Supplied completed transactions reject rather than
falling back to an unrelated transaction.

The new cases inspect records and inverse membership both inside the transaction
and from a separate connection. They cover all three bulk methods, both response
formats, owner commit/rollback, a following resource write in the same unit,
failure after the first or second child, completed transactions, zero-SQL
non-atomic rejection, auth identity and awaited data/finish ordering. No child
completion hook runs before the owner completes the borrowed transaction.
Managed completion and file/event integration are now verified separately.
The composed bulk and relationship traces above complete A4-03 while the
consumer inventory and migration requirements remain open.

## Bulk child cleanup (A7-F02 and A7-F03)

Bulk methods copied the caller's context into each child but discarded the
child's cleanup diagnostics and remaining upload tracking. This lost warnings
from successful calls as well as evidence from failed calls. Reusing retained
tracking in later children could also expose an earlier upload to their cleanup.

The existing bulk plugin now starts each child with fresh `cleanupErrors` and
`fileHandlingUploads` fields. One private function collects remaining entries
in each child's `finally`, copying each entry with its zero-based `bulkIndex`.
Original errors, storage objects and transaction objects retain their identities;
child entries are not annotated or mutated. Collection covers success, non-atomic
failure and atomic rethrow. A new batch clears old error diagnostics but retains
previous unresolved upload tracking without importing it into new children.

Nine core cases cover all three non-atomic methods, failures at multiple indexes,
rollback rejection and after-rollback/after-commit hook failures. Sixteen file
cases cover POST/PATCH in both formats, successful writes with cleanup warnings,
rollback cleanup, failed deletion and logging, post-commit failure before upload
tracking is released, actual files/rows and context reuse. Rollback-rejection
tests complete the real rollback before rejecting; they do not simulate an
uncertain native rollback outcome. These 25 regressions fail on the prior source
in each storage mode.

Real Socket.IO tests cover each non-atomic method over polling and WebSocket,
with successful or rejecting rollback cleanup hooks. Committed visible entries
emit events; rejected pre-commit and hidden entries do not. Separate real Redis
cases verify committed entries reach the other API server in both directions
after a middle-entry rejection and secondary cleanup failure. Acknowledgement
barriers establish the absence of extra events.

`meta.failed` counts rejected calls. An after-commit hook can reject while its
database changes remain committed; no rollback follows acknowledged commit.
Likewise retained upload tracking is not proof that a file should be deleted:
it can belong to committed data or a pending outer transaction. This change
preserves evidence; managed outer completion and machine-readable outcomes
remain A7/B1/B2. It adds no bulk completion hooks or retry policy.

### Stored file handles (A7-F04)

The first native bulk-file run also exposes a storage normalization defect:
ordinary file columns use binary SQL storage, and PostgreSQL returns the stored
UTF-8 URL as a Buffer. The API previously leaked that Buffer instead of a string.
All sixteen bulk-file cases fail their persisted URL assertion on PostgreSQL;
the same assertions pass SQLite, whose driver returns the submitted string.

The existing attribute normalizer now decodes byte-backed `file` values as UTF-8.
It handles Buffer and Uint8Array views, preserves byte-order marks and rejects
invalid encoding through the existing error wrapper with cause and field context.
Custom getters retain ownership of raw database values; response normalization
decodes a byte-backed file handle they return. Blob fields are unaffected.
Five additional cases cover both public representations through POST/PATCH/PUT,
GET and query, Unicode, sliced views, null/missing values, immutability, invalid
bytes and the getter boundary. This is storage decoding for the current column
contract; no DDL change, stored-data migration or API translator is introduced.

## Remaining error boundaries

This is the next A7/B4 review inventory, not a claim of complete failure
coverage. The bulk/resource changes above do not close the library-wide items.

### Driver completion promises (A7-F05)

The earlier failure tests rejected the transaction's `commit()` or `rollback()`
method. Knex's actual control-query path can resolve those methods while
rejecting `executionPromise`, so it escaped those tests. The library could then
run success/cleanup hooks or publish registry metadata after a failed completion.

The existing error-context module now provides a small `commitTransaction`
function that awaits both commit and the completion promise. The resource helper,
all three bulk methods and both registry commit sites use it. The existing
rollback helper also awaits completion before allowing `afterRollback` hooks.
Ownership guards and original-error/secondary-diagnostic behavior remain in
their existing callers. No new transaction manager or public method is added.

Forty-four shared cases exercise resource, relationship and atomic bulk writes.
Twelve canonical registry cases cover new/existing registration and allocation.
They send invalid completion SQL through the real driver, or inject rejection
after executing the real COMMIT/ROLLBACK. They check the resolved method,
rejected completion promise, original errors, completion hooks, cached metadata,
records and relationship membership. A test cleanup query restores a physical
connection left open by intentionally invalid control SQL; this is fixture
teardown, not evidence that the library confirmed rollback. Simulated lost
acknowledgement is distinguished from a real network-fault test.

The [selected outcome states](../GUIDE/transaction-outcomes.md) distinguish pending,
confirmed and unknown outcomes. Their public carrier and population are still
unimplemented; awaiting Knex's completion promise is necessary evidence handling,
not completion of B1/B2.

### PostgreSQL rollback acknowledged at commit (A7-F06)

A caught SQL error can leave PostgreSQL's transaction aborted. Its later COMMIT
then returns a ROLLBACK command tag, while both Knex completion promises resolve.
The write previously reported success, ran commit hooks and could publish registry
descriptors for changes that were not stored.

The existing commit helper now rejects that command tag. A private weak set
records the confirmed rollback for its transaction; the existing rollback helper
consumes it once before its completed-handle guard. This allows ordinary rollback
cleanup without issuing another control statement. No transaction/error object
is mutated to carry the evidence, and no new public API is introduced.

Eighteen PostgreSQL cases cover eight resource/relationship branches, three
atomic bulk methods, three registry operations and four upload scenarios. They
inspect the real command tag, both resolved promises, rows, linkage, hooks,
descriptor invalidation and successful/failed deletion of actual uploaded files.
Atomic bulk still has no managed outer completion hooks; B2 owns that work.

### Current boundary inventory

| Boundary | Current evidence and next verification |
| --- | --- |
| Resource/relationship cleanup | Eighteen helper cases and 56 shared driver cases cover original rejections, rollback/hook/logging failures, reuse and commit rejection after driver completion. Outer extension wrappers still need independent coverage. |
| Bulk cleanup | Twenty shared driver cases preserve child/validation/commit errors across rollback failures; 24 verify caller-owned participation. Nine non-atomic cases add indexed child diagnostics, rollback rejection, cleanup-hook rejection and post-commit failure. Managed/deferred events and outcome metadata remain open. |
| Include/projection error wrapping | The existing wrapper now retains non-Error causes and projection callbacks add field/resource context before crossing outer wrappers. Nested include catches retain context without duplicate logging. Ten wrapper cases, 54 helper/logging cases and 100 shared public-path cases cover these boundaries; unrelated extension callbacks remain open. |
| Query response copy | The redundant copy-error catch/log was removed. Twenty-four shared query/getRelated cases retain `DataCloneError` with successful, throwing and rejecting logging, both formats, borrowed transactions and recovery. |
| Getter/computed callbacks | `enrich-attributes.js` now uses the shared error wrapper for both callbacks. Typed errors retain identity; unexpected errors retain cause and field/resource/phase context. The shared 220-case callback suite covers primary/included/nested failures, both formats, response selection, owned/borrowed writes and real HTTP. |
| Setter callbacks | `applyFieldSetters` uses the same wrapper. Unexpected errors now remain server failures instead of becoming cause-less validation errors. Explicit `RestApiValidationError` retains 422. Frozen and non-Error rejections are covered in the callback suite. |
| Ordinary pivot existence validation | Both redundant catches in `many-to-many-manipulations.js` were removed. Related GET errors retain their actual classification and causes, matching canonical storage. The callback suite covers POST/PATCH/relationship replacement, record/pivot rollback and borrowed ownership. |
| File cleanup/upload conversion | Forty shared filesystem/HTTP cases cover cleanup diagnostics, later-file attempts, failed deletions, context reuse, completed transactions, non-Error causes and HTTP classification. Sixteen bulk cases add indexed diagnostics and retained tracking across child success/failure and context reuse. Upload tracking is tied to its transaction; owned commit releases its entries. Outcome metadata, borrowed completion, atomic-bulk side effects and previous-file replacement/deletion remain open. |
| Installed hook dispatcher | A public GET with a hook throwing null reproduces an unrelated `TypeError` with no original cause in installed `hooked-api` 1.0.24. Its scope/hook catches read `error.message` and log before rethrowing. This dependency boundary remains unresolved; include/projection wrapping does not fix arbitrary hooks. |
| AnyAPI registry | Forty-nine real metadata cases cover new/existing registration, allocation, rollback/logging failures, non-Error rejections, completed transactions, borrowed ownership, recovery and tenant/resource cache-key collisions. Owned failures use the shared rollback guard and invalidate their descriptor; rollback diagnostics are passed to the registry logger without mutating the original error. Concurrent schema writers and public outcome metadata remain open. |
| Canonical descriptor reads | Four broad inverse/reverse/polymorphic catches were removed. Registry reads retain causes and descriptor context. Sixty-five canonical cases include 420 individual failure injections over traced programmatic reads/writes and direct registry reads, required/absent descriptors, and real Express/Fastify requests. The native runner and Express 4 checks include this suite. |
| Post-write record refresh | The shared POST/PUT/PATCH helper now rejects failed refreshes before finish/commit, preserving causes and `postWriteRead` context. Forty-eight shared cases cover all return modes, both representations, owned/borrowed transactions, existing records/pivots, no completion hooks on failure and recovery after rollback. |

The original wrapper probe is recorded in
`/tmp/library-error-context-probe.log`; reproduced and fixed include failures
are recorded in [verification progress](verification-progress.md). Other
remaining boundaries are not marked complete based only on source inspection.
The query and hook probes are `/tmp/library-query-clone-logging-probe.log` and
`/tmp/library-hook-null-probe.log`.
The canonical descriptor read probe is
`/tmp/library-registry-include-read-probe.log`; it does not establish an
acceptable partial-response policy.

### B4 callback/include policy inventory

The only direct runtime invocations of `.setter`, `.getter` and `.compute` are
the three boundaries above. They now propagate failure. The include loaders
in `knex-relationship-includes.js`, its outer `knex-process-includes.js`, query
projections and canonical descriptor reads already use the shared wrapper or
directly await a rejecting operation. No best-effort response option is added.

These other branches have separate meanings and must not be conflated:

| Branch | Meaning / remaining work |
| --- | --- |
| Explicit callback return such as null for zero votes | Successful domain value. Keep it; the library no longer manufactures that value after an unexpected rejection. |
| Invalid request fields/includes/cursors | Request validation rejects with a typed client error before enrichment. Existing fieldset/include contract suites cover unknown paths; cursor parsing deliberately classifies malformed client data. |
| Denied access | Typed authorization errors propagate. Row-policy filtering can deliberately omit inaccessible records; that is separate from swallowing a thrown error. |
| No include requested, empty relationship, nullable target, empty query result | Successful absence follows the relationship/read contract. A direct missing resource or required pivot target rejects with not-found. |
| Unused output | Sparse fields and minimal/none write responses do not evaluate callbacks merely to produce discarded attributes. Dependencies and internal related reads can still require them. |
| Cleanup after an earlier failure | Shared rollback/file handlers retain secondary diagnostics without replacing the original failure. Post-commit work cannot undo acknowledged commit. The B4-05 acceptance review verifies outcome reporting, no post-commit rollback, continued managed completion chains and temporary-file warnings; remaining A7 and consumer items retain their own scope. |
| Stored polymorphic target type | The shared linkage helper rejects undeclared types in ordinary/canonical reads, including direct linkage and nested includes. Previously ordinary includes skipped the target while canonical storage could include a registered but undeclared resource. Real-row corruption tests cover this distinction. |
| Ordinary include traversal's unhandled-relationship warning | This also implements a valid polymorphic union: `subject.profile` can apply to writers while books have no profile branch. `include-traversal.test.js` verifies that behavior and rejection of paths supported by no declared target type. Keep that branch; it is not a swallowed failure. |
| Required scope/reverse metadata | Nonempty relationship work now rejects missing scope schema. Ordinary reverse `via` processing rejects an absent/non-polymorphic target relationship; canonical reverse processing rejects missing foreign-key slots or polymorphic columns. Empty work remains valid. |
| Schema relationship enumeration | Empty catches in `toJsonApiRecord` and `buildFieldSelection` now wrap unexpected causes with resource/`relationshipMetadata` context. Public GET/query tests inject a failure at each observed relationship read; helper cases cover typed, frozen and null throws. Optional absent relationship maps still work. |

The source search is recorded in
`/tmp/library-field-callbacks-boundary-inventory.log`. This inventory completes
the classification task, not all remaining behavior changes or consumer ports.
The installed hook dispatcher's null-throw defect remains separate from the
field callback boundaries repaired here.

## Existing consumers and the chosen change

The baseline lifecycle map already identified the major helpers. The current
source confirms the following consumers of the retained boundaries:

| Consumer | Boundary it uses |
| --- | --- |
| AutoFilterPlugin | Method-specific processing hooks stamp/validate scope values; query filtering constrains reads |
| RowPolicyPlugin | Storage query filtering applies visibility |
| QueryProjectionsPlugin | Before-schema hook strips projected fields from writes |
| FileHandlingPlugin | Before-processing upload handling and rollback cleanup |
| SocketIOPlugin | Before-data membership capture, finish-time notifications and transaction completion hooks |
| PositioningPlugin | Before-schema and before-data hooks; work on this plugin is paused |
| jskit-ai temporal plugin | `finish` normalizes `context.record` and `context.responseRecord`; read-only source inspection at `701635463` |

POST, PATCH and PUT each repeat an attributes-presence check, a call passing
attributes and schema information already in context, and assignment of the
result back to that same context. The existing `applyFieldSetters` owns the
conversion itself. Its only runtime callers are those three methods; one focused
temporal test imports it directly. jskit-ai's host does not import it.

The smallest sufficient change is to let that existing helper accept the write
context, apply the presence check, and replace its attributes after every setter
succeeds. Its selected signature is `applyFieldSetters(context, api, helpers)`.
Callers invoke it once at the existing location. The resource CRUD API, hook
names, setter callback arguments and transaction timing stay the same. The
deep-helper signature change is recorded in the migration guide; no forwarding
signature or old/new parser is needed.

A new write-operation engine would introduce dispatch and POST/PUT/PATCH result
special cases. Extracting before-data through after-data as one sequence would
also hide the different relationship locks. Keep those decisions visible.
DELETE and relationship methods do not call field setters directly, so this
change does not add a new shared path for them.

A second existing boundary is `handleRecordReturnAfterWrite` (A4-12). All three
return branches repeat the same two finish hooks, and the minimal/full branches
repeat final normalization. Only POST/PATCH/PUT call this helper; its uppercase
DELETE branch is unused. Four accepted parameters are also unused. Consolidate
finish/normalization after the existing response selection, remove those unused
parameters and the dead branch, and keep the minimal refresh and nested GET in
this helper. Preserve `none` returning undefined even if a finish hook sets
`responseRecord`. This needs no new helper or public API change. The 271 traces
and existing temporal/fieldset response tests provide the before/after checks.
The setter helper reads validated attributes and compiled setter order from
the write context, then replaces `inputRecord.data.attributes`; it returns no
value. The response helper updates `originalMinimalRecord`, `minimalRecord` and
`responseRecord`, returning the normalized response or undefined for `none`.
Neither helper commits or rolls back the supplied transaction.

Together the setter and response changes remove 105 lines from POST, PATCH, PUT
and `common.js` (1,505 to 1,400), without adding a runtime helper.

## Final write response boundary

Further response review reproduced two defects. Write finish hooks could add
fields after the nested GET had applied the requested fieldsets. The final write
normalizer now applies those fieldsets using the existing field-filter helper
and plain-record relationship traversal; it does not introduce a second walker.

The returned response also shared references with `context.responseRecord`
during `afterCommit`. Twelve fieldset cases and twelve temporal cases show that
a side-effect hook could add excluded fields or replace normalized strings with
native/invalid dates after response preparation. Generated-ID traces pass on the
unmodified runtime, so ID timing needs coverage rather than a new implementation.

The chosen local change is one `structuredClone` of the normalized response in
the existing response helper, before transaction completion. Finish hooks remain
the last response mutation point. After-commit observers retain the same context
and are awaited, but mutating its response cannot change the returned snapshot.
`none` still returns undefined and avoids the copy. Minimal and full output are
detached in both formats, including nested data and metadata. Response extensions
must be cloneable data; a copy failure happens before commit and follows normal
owned/borrowed failure handling. No new serializer or transaction framework is
needed. The cost is one copy proportional to the selected response size.

Reused contexts also retained the previous operation's ID in early POST, PUT and
PATCH hooks. Four generated-POST cases fail before the initial POST reset, and
the extended matrix then exposes twelve PUT/PATCH failures. Clear the ID in
`setupCommonRequest` alongside the existing transaction/input state resets.
Keep assignment at its established boundary: after insertion for POST, after
request ID validation for PUT/PATCH. The shared fixture can seed generated IDs
for these cases, avoiding assumptions about native sequence advancement after
explicit inserts or rolled-back writes.

Normalizing again after commit would allow response preparation to fail after a
successful write. Freezing the hook context would turn mutations into post-commit
exceptions. A detached response keeps preparation before commit without either
change. No actual consumer migration is claimed while consumer work is paused.

## Review of the resulting methods

The top-to-bottom review retains the two existing helpers and their explicit
call sites. PATCH still selects partial validation, checks existence and
authorization, merges only supplied relationship changes, takes the appropriate
target/parent locks, applies setters, writes, and prepares its response before
commit. The simplification adds no new flags or callback layer. PUT retains its
own create/replacement and omitted-relationship decisions; POST assigns the
inserted ID at the storage boundary.

DELETE already shares transaction completion/error handling but has no setter
or response preparation to extract. POST/DELETE relationship methods keep their
distinct add/remove operations and share payload validation, parent visibility,
locking and completion helpers. PATCH relationship already delegates to resource
PATCH with a separate context, the borrowed transaction and `returning: 'none'`.
All relationship writes return no record. Routing these methods through the
resource response helper would require unnecessary switches and refreshes.
Keep those sequences separate; this review selects no further hook rename or
extraction. Relationship/bulk trace coverage and transaction-outcome work remain
open, independently of this reuse decision.

## Write-error boundary and transaction snapshots

Owned completion requires a top-level transaction. A custom factory's savepoint
now rejects before release, follows confirmed rollback cleanup, and leaves
unrelated parent work with its owner. This prevents `transactionCommitted` and
`afterCommit` from implying outer commit after a savepoint release. Explicit raw
borrowed savepoints retain caller ownership in the current worktree; the
[managed transaction target](../GUIDE/managed-transactions.md) will replace unmanaged
library writes. That target is specified but not implemented.

Resource and relationship write registrations now share `withWriteOutcome` from
the existing error-context module. It resets per-operation failure and
transaction state before method validation, and wraps a rejected operation in
`RestApiWriteError`. Bulk registrations use the same boundary; registry writes
use the same wrapper with their local context. Reads retain their existing
error contract. This adds no lifecycle registry or operation-specific mode flags.

The existing method bodies still decide when to acquire a transaction, what to
validate and write, and whether they own completion. Their failure handlers
still preserve rollback, cleanup and logging diagnostics. The outer wrapper
keeps the original failure in `cause`, copies classification data, and records
an immutable outcome at rejection. Reusing a context or frozen primary error
does not rewrite an earlier error's outcome.

The shared completion helpers now record confirmed commit/rollback and uncertain
completion on that operation's context. Borrowed operations remain pending until
their owner completes them; an already-completed borrowed handle without observed
evidence is unknown. An atomic child and its owning batch can therefore report
different snapshots in the same cause chain. HTTP errors and non-atomic bulk
entries carry the outcome without exposing transaction handles.

This boundary does not supply managed outer completion. Deferred notifications,
uploads and explicit nesting remain B2 work, and consumer error classification
must still be migrated when consumer work resumes. See the
[outcome contract](../GUIDE/transaction-outcomes.md) and
[migration guide](../GUIDE/MIGRATING_API_V2.md#transactions-and-errors).

## Verification scope

`tests/conformance-lifecycle.test.js` uses the shared real-driver fixture. It
checks all five resource operations, both output formats, all applicable return
modes, owned/borrowed transactions, exact enter/exit traces and hook-visible
context. Every observed resource/read hook, setter and typed getter failure is
injected separately. Final stored data is checked after failures and after the
borrowed transaction's owner rolls back. The test's expected stages are an
explicit contract; they are not discovered from the runtime's hook calls.

The initial unmodified runtime passes all 271 cases in each SQL/storage
combination: **1,626 baseline checks**, with no failures or skips
(`/tmp/library-lifecycle-trace-before-native.log`). The implementation removes
27 repeated lines from POST/PATCH/PUT without adding another helper; the existing
helper's line count stays the same. After both changes, the lifecycle/format/
transaction-context/fieldset matrix passes 411 per SQL/storage combination,
**2,466 per runtime**, and the full gates pass on Node 22 and 24. Exact results
are in the [execution evidence](verification-progress.md). That checkpoint did not yet prove generated-ID timing or response isolation.
The expanded lifecycle suite now passes 368 cases per mode, and the seven-file
native verification passes 4,427 checks per runtime, with both full gates passing.
It covers generated-ID assignment, reused contexts, final fieldsets, native and
invalid finish-hook values, after-commit isolation and copy-failure ownership.
Relationship/bulk traces, secondary rollback failures, the broader normalization
contract and consumer workflow migration remain open.
