// @ts-check
import { createKnexTransaction, finishKnexTransactionConnection } from '../../lib/knex-transaction.js'
/** @import { StorageDatabase } from '../../plugins/core/lib/storage/storage-types.js' */

// Compiled only: creating and releasing real leases belongs to the conformance tests.
/** @param {StorageDatabase} database */
export async function checkTransactionLeaseContracts (database) {
  const context = { cleanupErrors: [{ phase: 'preparation', error: new Error('Earlier failure') }] }
  const transaction = await createKnexTransaction(database, context)
  await transaction.executionPromise
  await finishKnexTransactionConnection(transaction, 'committed')
  await finishKnexTransactionConnection(transaction, 'rolledBack', 'Callback failure')
  await finishKnexTransactionConnection(transaction, 'unknown', null)
  await finishKnexTransactionConnection(undefined, undefined)
  await finishKnexTransactionConnection(null, 'none')

  // @ts-expect-error A database handle does not establish transaction ownership.
  await finishKnexTransactionConnection(database, 'committed')
  // @ts-expect-error The transaction must be resolved before completing its lease.
  await finishKnexTransactionConnection(createKnexTransaction(database), 'committed')
  // @ts-expect-error Completion uses the actual acknowledged-outcome vocabulary.
  await finishKnexTransactionConnection(transaction, 'success')
  // @ts-expect-error Diagnostics retain errors rather than bare message strings.
  await createKnexTransaction(database, { cleanupErrors: ['Release failed'] })
  // @ts-expect-error An SQL-completion promise alone is not an owned transaction.
  await finishKnexTransactionConnection({ executionPromise: Promise.resolve([]) }, 'unknown')
}
