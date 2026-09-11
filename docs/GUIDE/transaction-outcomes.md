# Transaction outcome contract

This is the selected vocabulary for B1-01. Resource, relationship, bulk and
canonical registry write errors now use the carrier below; HTTP mapping and
non-atomic bulk errors carry its outcome. **The library carrier and failure
tests pass verification**, completing B1-06; retry guidance completes B1-07.
B1-03 outcome population also passes verification, including rejection of owned
savepoint completion. B1-02/B1-04/B1-05 remain open for consumer migration; the
broader A7 failure audit remains separate. Exact scope
is recorded in the evidence log (source checkout: `docs/development/verification-progress.md`).
These definitions apply to the transaction represented by a failure, at the
time that failure is reported.

**Verified library scope:** managed callback ownership, nesting, completion
ordering, file lifetime and conflict handling are implemented and tested.
[Managed transactions](managed-transactions.md) describes the current contract;
verification evidence (source checkout: `docs/development/verification-progress.md`) records exact test scopes.
Consumer migration and the broader extension/failure audit remain unfinished.
These guarantees cannot recover an error already swallowed by an extension.

## The five states

| State | Exact meaning |
| --- | --- |
| `none` | No transaction was acquired or accepted for this operation. This includes rejection before transaction setup. It does not certify that external or nontransactional work had no effects. |
| `pending` | The operation participated in a transaction whose owner has not completed it. The owner still must decide its outcome. A database error may have made further SQL unusable; pending does not mean the owner can safely continue writing. |
| `committed` | The backend confirmed commit of the represented outer transaction. Later hook, file, notification or logging failure does not change this outcome. Releasing a savepoint does not establish outer commit. |
| `rolledBack` | The backend confirmed rollback of the represented transaction. Later cleanup failure does not undo that confirmation. This says nothing about external effects performed before rollback. |
| `unknown` | A transaction was acquired or accepted, but the available evidence cannot establish its outcome or leave it confidently pending. Examples include lost completion acknowledgements, failed completion/rollback, and an accepted handle completed outside its owner without observed outcome. |

Use these values consistently. Do not add
synonyms for driver states or infer them from exception messages. Ownership is
separate from outcome: an individual resource operation borrows its caller's
transaction, including a transaction managed by an outer library operation.

## Evidence and transitions

Transaction setup starts with `none`. Successful acquisition or acceptance of
an unfinished transaction moves to `pending`. An operation that merely borrows
that transaction leaves it pending; its own success or rejection does not commit
or roll back the outer unit. A rejected statement may require the owner to roll
back even if the driver's handle remains usable-looking.

The private transaction owner controls completion; a hook changing the mutable
`shouldCommit` diagnostic flag neither takes ownership nor suppresses an implicit
owner's commit or rollback. Participating operation errors stay pending snapshots
even when the outer helper later reports rolledBack.

Confirmed commit or rollback establishes `committed` or `rolledBack`. A failed
completion attempt without confirmation establishes `unknown`. If a subsequent
rollback is actually confirmed, the reported outcome can be `rolledBack`; a
cleanup attempt or a resolved wrapper alone is insufficient. Once commit is
confirmed, later failure remains committed and must not trigger rollback.

Knex 3.1.0 exposes a specific trap: `commit()` and `rollback()` can resolve even
when their control query failed, while `executionPromise` rejects. Its
`isCompleted()` flag is set when completion starts and after failures; the flag
alone proves neither commit nor rollback. The current shared completion helpers
now await `executionPromise` before reporting successful completion to hooks or
the registry. Driver-path regressions cover rejected SQL and injected lost
acknowledgements after real execution.

The shared helper also rejects a PostgreSQL COMMIT response reporting ROLLBACK.
Both Knex promises can resolve in this case, but the backend has confirmed that
the writes were rolled back. The existing failure path consumes that confirmation
once, without sending another ROLLBACK. Resource rollback hooks can then clean
uploaded files; commit hooks and registry cache publication do not run.

Owned completion now requires a top-level transaction. A custom transaction
factory returning a savepoint is rejected before release; the existing failure
path rolls back that savepoint and leaves its caller-owned parent active.
No commit hook or committed registry cache publication follows that rejection.
The managed implementation rejects raw transactions and savepoints supplied to
library writes before acceptance, with outcome none. A managed handle completed
outside its owner after acceptance instead has outcome unknown. Connection
failure during commit must remain unknown unless available evidence establishes
the outcome. The error remains a snapshot even if the application later
reconciles the database state.

## When commit acknowledgement is lost

A connection can fail before COMMIT reaches the database or after the database
commits but before the caller receives confirmation. A rejected promise or HTTP
500 alone cannot distinguish those cases. `unknown` deliberately preserves that
uncertainty; it is not a synonym for rolledBack.

| Observed evidence | Reported outcome and behavior |
| --- | --- |
| Commit and driver completion acknowledged, then an after-commit hook fails | `committed`; retain the failure, never attempt rollback of the committed write. |
| Commit control statement or its completion promise rejects without acknowledged outcome | `unknown`; no speculative commit/rollback hooks. A driver's completed flag alone does not establish success. |
| PostgreSQL acknowledges COMMIT as ROLLBACK | `rolledBack`; run rollback completion work without issuing a second rollback. |
| Rollback is acknowledged, then cleanup fails | `rolledBack`; retain the primary write error and secondary cleanup diagnostics. |
| Rollback itself cannot be acknowledged | `unknown`; keep the original failure and rollback diagnostic. |

The Knex storage plugins and owned AnyAPI registry operations retain the
physical connection lease until the
transaction completion promise settles. A failed completion marks that connection
disposed before releasing it, so even a request already waiting for the pool
cannot borrow its unfinished transaction. A failed BEGIN also rejects before the
application callback runs. Acknowledged completion keeps normal connection reuse.

Owned PostgreSQL `alterKnexFields` also uses the managed completion runner.
A deep-helper call given an existing transaction uses a savepoint and leaves
completion to that caller. SQLite table rebuilds are Knex-managed internally;
the library holds their connection lease through error cleanup, rolling back a
transaction the driver reports still active and restoring foreign-key enforcement
before release. If cleanup cannot establish a reusable connection, it is disposed.
See the [schema guide](GUIDE_X_Knex_Schema_And_Migrations.md) for DDL-specific
ownership, cleanup errors and dialect restrictions.

If a completion method rejects without settling its driver completion promise,
an owner finishing with outcome `unknown` also discards its unreleased connection
lease. A later driver promise settlement cannot release the lease twice. The raw
driver promise may remain unsettled; application completion follows the library
call and its outcome, rather than waiting on that internal promise.

Connection release is cleanup, separate from the driver's SQL-completion promise.
A release error after acknowledged COMMIT keeps outcome `committed`; it becomes a
post-commit error and later completion hooks/finalizers are still attempted. A
release error after confirmed rollback keeps `rolledBack`, preserves the original
failure, and adds a `connectionRelease` diagnostic to the owner's cleanup errors.
Failed BEGIN also retains its original cause if releasing its lease fails.

Disposal does not establish whether a write committed, and does not replay it.
Knex destroys the disposed connection during pool validation or idle cleanup;
this is not a guarantee of immediate server-side lock release. SQLite `:memory:`
data belongs to its connection and is lost when that connection is discarded;
use a file-backed database when data must survive connection replacement.

After `unknown`, reconcile using application-owned operation identity and
persisted state before deciding whether to issue a new write. Do not treat a
previously captured participant error as the owner's final outcome. Do not infer
that files in upload tracking are safe to delete: they may belong to committed
rows. Outcome-dependent hooks are skipped when the outcome is unknown, so
notifications and other in-memory completion work may require reconciliation as
well. There is no durable outbox, automatic retry or exactly-once delivery.

Database rollback does not undo email, remote calls or other effects performed
outside that database. Even `rolledBack` permits a safe retry only when the
application can repeat or reconcile those effects. See the
[file ownership contract](GUIDE_X_File_Uploads.md#ownership-after-commit).

The completion tests inject failures at the actual driver query boundary before
and after executing COMMIT/ROLLBACK, inspect persisted rows afterward, and
assert no outcome hooks run for unknown completion. They cover real supported
databases, but do not simulate every network partition, server failover or
physical connection-loss sequence. This contract reports available evidence;
it does not promise to resolve an acknowledgement the client never received.

## Selected error carrier

Writes reject with `RestApiWriteError`, exported from the package root. Its
read-only `transactionOutcome` is one of the five strings above. `cause` retains
the original thrown value, including a frozen error, null or undefined; a fresh
wrapper is created for each failed operation. Read errors retain their existing
contract. Errors already lost inside an extension's own catch cannot be restored
by the write boundary; the installed hook dispatcher's null-throw issue remains
an independent boundary.

The wrapper retains ordinary data fields used for classification: `code`,
`type`, `subtype`, `details`, `statusCode`, `status`, `path`, `parameter` and
`validation`, including inherited status fields from HTTP error classes. It does
not execute diagnostic getters. Without an original code,
its code is `REST_API_WRITE`. The original error class is available through
`cause`; the wrapper itself has class `RestApiWriteError`. Its JSON representation
omits the cause, stack and transaction handle while retaining diagnostic fields.

An atomic child's wrapper can be the outer wrapper's cause. Both snapshots are
retained: for example, child pending and outer rolledBack. Existing code/subtype
classification can usually remain at the outer error; code that checks original
error identity or `instanceof` needs migration. HTTP mapping preserves status
classification and adds `meta.transactionOutcome` to each JSON:API error.
Non-atomic bulk entries expose `error.transactionOutcome` individually.

## Errors, batches and later observations

Outcome evidence must survive a secondary cleanup error without replacing the
primary failure or its cause. The selected wrapper carries frozen errors and
non-Error throws without mutating the original value.
Completion hooks and internal diagnostic finalizers are attempted in their
documented order despite earlier completion failures. After commit, the first
such failure remains primary. Finalizer errors after rollback or unknown
completion remain secondary; they do not change the observed outcome or cause
speculative outcome hooks to run. See the
[managed completion contract](managed-transactions.md#completion-work).
Only safe, serializable outcome fields belong in transport errors. Transaction,
connection, storage and raw cleanup objects remain internal diagnostics.

An outcome attached to an error is a snapshot, not a live view. A borrowed
operation can report pending and its owner later report rolledBack. Later
confirmation belongs to the owner's completion result; do not mutate previously
reported failures or their causes to rewrite that history.

An atomic batch has one transaction outcome. A non-atomic batch has separate
outcomes for its entries; it must not claim one shared committed/rolledBack
outcome from aggregate success counts. Its `meta.failed` counts rejected calls,
including possible post-commit failures. B1-05 supplies the per-entry transport
representation without inventing a sixth transaction state for mixed results.

None of these states is a general retry instruction. Repeating a committed or
unknown write can duplicate effects. Pending work belongs to its owner. Even a
confirmed rollback cannot undo an email, upload, external API call or other
effect outside the database transaction. No automatic replay of arbitrary hooks
or setters is part of this contract.

### Known dispatcher limitation under repair

The installed hooked-api diagnostic logger can replace a post-commit hook failure
with its own error if logging also throws. That error can lack `transactionOutcome`
even though the caller's context retains `committed` and the row is stored. The
pending dispatcher patch (source checkout: `docs/development/pending-hooked-api/README.md`) addresses rejected-handler
logging but has not been installed/released. The master plan therefore keeps the
whole-API post-commit evidence and error-preservation items open; the guarantees
above describe the library's owned transaction handling, not a completed fix for
this external dispatch failure.
