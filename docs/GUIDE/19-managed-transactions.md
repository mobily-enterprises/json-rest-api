---
title: "Managed transactions"
chapter: 19
chapter_label: "19"
---

# 19. Managed transactions

Use `api.transaction()` to group resource operations and raw SQL in one explicit
unit. The helper owns commit, rollback and completion hooks. Pass its transaction
to every participating operation; the library does not infer ambient ownership.

## Callback and result

```js
const result = await api.transaction(async transaction => {
  const book = await api.resources.books.post({
    data: { title: 'New book' },
    format: 'plain',
    transaction
  })
  await transaction('audit_entries').insert({ book_id: book.id })
  return book
})
```

`api.transaction(callback, context = {})` acquires one top-level transaction,
awaits the callback, completes the transaction, awaits its completion work and
returns the callback's value unchanged. The second argument is mutable diagnostic
context, consistent with other API methods; it is not a second options parser.
Invalid callbacks fail before acquisition. The callback receives the actual
Knex transaction, so existing first-argument `transaction` forwarding and raw SQL
remain straightforward. No transaction is inferred from process-global or async
ambient state. Callers must await all work before the callback returns.
Individual resource calls inside the callback resolve while the unit is still
pending; only the outer helper waits for commit and completion hooks. Both
synchronous callback values and awaited promises are supported, including
undefined. The helper does not clone or serialize the callback result.

The helper owns completion. The callback must not invoke commit/rollback,
transaction-control SQL or DDL that implicitly completes its transaction. A
handle completed outside the helper is rejected with an unknown outcome unless
the library has actual completion evidence; it must not trigger speculative
rollback cleanup or commit notifications. SQL/connection error evidence also
cannot be replaced by a later successful empty COMMIT.

## Participation and failure

Ordinary resource and relationship calls without a transaction use the same
completion mechanism for their own transaction. Atomic bulk uses it for the
whole batch. Calls receiving its transaction participate and never complete it
individually. Non-atomic bulk with an outer transaction continues to reject.

The final contract requires library writes to use a library-owned transaction.
Standalone transactions created with `knex.transaction()` remain usable for raw
SQL, but passing them into library writes will reject before partial work.
Migrate those units to `api.transaction`; its callback still receives a real
Knex handle. This replaces the previous ambiguous borrowed-write mode in which
notifications/uploads can wait forever for an unobserved owner. Read-only/raw
storage use is not a competing event-delivery mode.

Canonical `addKnexFields()` batches use this helper too. Direct registry writes
that receive a transaction require a managed handle. Their caller still
invalidates the registry descriptor cache after confirmed commit; this does not
publish a new compiled resource schema. Raw descriptor reads and schema/data
migration helpers retain their separate documented transaction contracts.

Any rejected participating write marks the unit failed, even if the callback
catches the error and returns normally. Observed SQL failures also prevent a
later commit from masking aborted work. A rejected callback or failed unit rolls
back; no automatic retries or savepoints restore it. A failure before acquisition
has outcome none. Participant errors retain their pending/none snapshot, and an
outer error records the owner's eventual outcome without rewriting its cause.
If the callback rejects, its rejection is primary. If it returns after catching
failures, the first recorded participant/SQL failure is primary instead.

A native lock timeout, deadlock or stale SQLite snapshot is reported to the
caller. The library does not replay the callback, field setters or hooks.
Effects performed outside the database before the conflict can therefore remain
once even though the database write rolls back. Retry only a new complete unit
whose external effects your application can safely repeat or reconcile; never
retry just the failed statement inside an already failed unit.

## Completion work

Each accepted resource/relationship operation enlists its existing completion
hook chain once. This includes nested resource calls made by relationship
implementation; helper-internal SQL does not create synthetic operations. Bulk
or transaction owners do not also run a duplicate resource hook chain.

After confirmed commit, invoke enlisted `afterCommit` chains in enlistment
order. After confirmed rollback, invoke `afterRollback` chains in reverse order.
A chain retains its normal local stop-on-error behavior; failure in one chain
does not prevent other enlisted operations' completion work from being attempted.
Collect secondary failures in owner diagnostics. Retain the original callback/
write failure on rollback; after commit, report the first completion failure as
the primary error with outcome committed. Unconfirmed completion runs neither
set of outcome-dependent hooks.

Enlistment happens when the library accepts an operation into the transaction.
Overlapping operations can finish their writes in another order; that does not
change completion-hook order. Internal finalizers, currently bulk diagnostic
collection, run after those chains in registration order even when a chain or
an earlier finalizer fails. They also collect diagnostics after unknown
completion; they must not infer commit or run outcome-dependent side effects.
The first post-commit failure remains primary across hooks and finalizers.

Use the existing diagnostic shape on the owner's context: `error` is the primary
failure and `cleanupErrors` is an ordered array of `{ phase, error }` entries.
Completion-chain entries additionally identify `operationIndex`, `scopeName`
and `method`; phases distinguish `rollback`, `afterRollback` and `afterCommit`.
Secondary finalizer failures use phase `finalization` and `finalizerIndex`.
The error carrier retains its cause even when any of these values are frozen or
non-Error throws. Do not serialize transaction handles or raw cleanup objects
into HTTP errors.

An operation's mutable context remains in use until its owner completes. Use a
separate context object per operation; reject reuse through library calls while
that context is still enlisted. Do not copy arbitrary contexts, replay mutations
into reused objects, or rebuild scope-aware hook dispatch in the transaction
helper. Completion hooks receive their operation's context, with the observed
owner outcome added at completion. Previously thrown errors remain immutable
snapshots. Application code must not mutate an enlisted context concurrently.
The private owner record controls commit and rollback. Changing the diagnostic
`shouldCommit` flag cannot transfer ownership to a participant or stop an
implicit owner from completing. During rollback, a failed operation retains its
original error; an operation that succeeded before the unit failed receives the
owner's error in its rollback context.

File cleanup/tracking and Socket.IO delivery use these existing hooks. Uploaded
files are cleaned only after confirmed rollback, and notifications run only
after confirmed outer commit. Bulk diagnostics aggregate unresolved child state
after finalization; the parent must not delete a child's files a second time.
Tests cover repeated changes to the same resource, multiple uploads,
callback/SQL failures and failing completion hooks. File-specific failures and
unresolved upload tracking remain on each operation's context; rejected hook
chains are reported on the owner. After confirmed commit, stored objects are
application-owned. Replacement and deletion preserve previously committed files:
opaque URLs may be shared by other records or external consumers. Rollback
removes only new uploads belonging to the failed unit. See the
[file ownership contract](26-file-uploads.md#ownership-after-commit)
for application-managed garbage collection.

Socket.IO notices are per-operation invalidations, without coalescing: a
sequential create/update/delete can emit all three after commit. Callback
rollback discards the queue. The selected tests check pending silence, ordered
notices, real committed/rolled-back rows, visibility filtering and a later
chain flushing once after the first chain fails. These are awaited in-memory
notifications, not durable delivery or an exactly-once guarantee.

Notification capture order is the order in which operations reach the Socket.IO
finish hook's queue. For overlapping writes it can differ from enlistment order.
The first successful delivery chain drains that queue without reordering it.
Real polling/WebSocket tests deliberately pause the first enlisted write so the
second finishes first, and verify both distinct orders.

## Nesting and application ownership

An application-created Knex transaction is unmanaged from this library's point
of view: the application decides when it finally commits or rolls back. That
final outcome controls after-commit hooks and rollback cleanup, so passing an
arbitrary Knex transaction into resource writes is rejected. Use
`api.transaction` to group resource operations and raw SQL under one owner.

A savepoint is a rollback checkpoint inside an outer transaction. Releasing it
does not commit that outer transaction. Resource writes therefore cannot treat
savepoint success as permission to send notifications or run after-commit hooks.

Every `api.transaction` call starts an independent top-level unit. There is no
implicit joining or nested callback overload. To compose work within one unit,
pass its transaction to ordinary functions and resource methods. Managed library
writes do not support child savepoints; reject them explicitly instead of
treating savepoint release as outer commit. The current owned-completion guard
already rejects a custom factory's savepoint; its caller-owned parent survives.

When migrating an application's transaction wrapper, delegate to `api.transaction`
and forward the received handle. Port raw transaction creation, context reuse and
error handling together. Preserve domain scope resolution in application code;
keep completion ownership in one place.
