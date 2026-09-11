// @ts-check
import { beginWriteTransaction, commitTransaction, getWriteOutcome, onTransactionFinished, rollbackAfterError, transactionMethod, withAvailableContext, withWriteOutcome } from '../../lib/error-context.js'
import { createKnexTransaction } from '../../lib/knex-transaction.js'
/** @import { StorageDatabase } from '../../plugins/core/lib/storage/storage-types.js' */
/** @import { TransactionContext, TransactionState } from '../../lib/transaction-types.js' */

/** @param {StorageDatabase} database */
export async function checkTransactionContextContracts (database) {
  /** @type {TransactionContext} */
  const context = {}
  const transaction = await beginWriteTransaction(context, null, owner => createKnexTransaction(database, owner), async hook => {
    const name = /** @satisfies {'afterCommit' | 'afterRollback'} */ (hook)
    return name
  })
  onTransactionFinished(transaction, () => {})
  await commitTransaction(transaction, context)
  await rollbackAfterError(undefined, context, transaction)
  const outcome = getWriteOutcome(context)
  if (outcome === 'committed') context.transactionCommitted = true

  const run = withWriteOutcome(transactionMethod)
  const value = await run({ context, params: async () => 42, helpers: { newTransaction: owner => createKnexTransaction(database, owner) } })
  value.toFixed()
  const read = withAvailableContext(/** @param {{ context: TransactionContext, id: string }} request */ request => request.id)
  read({ context, id: 'book-1' }).toUpperCase()

  // @ts-expect-error Only resolved transactions may complete.
  await commitTransaction(database, context)
  // @ts-expect-error Factory results must be owned transactions, not database handles.
  await beginWriteTransaction(context, null, async () => database)
  // @ts-expect-error Completion cannot use an invented outcome.
  context.transactionOutcome = 'successful'
  // @ts-expect-error Completion hooks must be callable.
  await beginWriteTransaction(context, null, owner => createKnexTransaction(database, owner), 'afterCommit')
  // @ts-expect-error Finalizers must be callbacks, not already-started promises.
  onTransactionFinished(transaction, Promise.resolve())
  // @ts-expect-error Generic read wrappers retain their actual request fields.
  read({ context })
  // @ts-expect-error The transaction callback result remains numeric.
  value.toUpperCase()
}

/** @param {TransactionState} state */
export function checkTransactionStateContracts (state) {
  state.phase = 'finishing'
  state.inFlight.get(state.owner)?.resolve()
  // @ts-expect-error Internal lifecycle phases differ from acknowledged SQL outcomes.
  state.phase = 'committed'
  // @ts-expect-error A participant must identify its context and completion hook.
  state.participants.push({ operationIndex: 0 })
}
