// @ts-check
/** @import { OwnedTransaction, TransactionOutcome } from './transaction-types.js' */
/** @import { StorageDatabase } from '../plugins/core/lib/storage/storage-types.js' */
/** @typedef {{ cleanupErrors?: Array<{ phase: string, error: unknown }>, [serializableTransaction]?: boolean }} CleanupContext */
/** @type {WeakMap<OwnedTransaction, (error?: unknown) => Promise<void>>} */
const transactionConnections = new WeakMap()

// Internal connector request; HTTP input cannot select transaction isolation.
export const serializableTransaction = Symbol('serializableTransaction')

// Own the lease without changing the driver's SQL-completion promise.
/**
 * @param {StorageDatabase} knex
 * @param {CleanupContext} [context]
 * @returns {Promise<OwnedTransaction>}
 */
export async function createKnexTransaction (knex, context = {}) {
  /** @type {{ __knex__disposed?: unknown }} */
  const connection = await knex.client.acquireConnection()
  /** @type {OwnedTransaction | undefined} */
  let transaction
  /** @type {Promise<void> | undefined} */
  let releasePromise
  /** @param {unknown} [error] */
  const release = error => {
    releasePromise ||= (async () => {
      if (error !== undefined) connection.__knex__disposed = error || true
      await knex.client.releaseConnection(connection)
    })()
    return releasePromise
  }
  try {
    const serializable = context[serializableTransaction] === true
    const sqlite = ['sqlite3', 'better-sqlite3'].includes(knex.client.config.client)
    transaction = await knex.transaction({ connection, ...(serializable && !sqlite ? { isolationLevel: 'serializable' } : {}) })
    transactionConnections.set(transaction, release)
    transaction.executionPromise.then(
      () => release(),
      error => release(error || true)
    ).catch(() => {})
    if (transaction.isCompleted()) await transaction.executionPromise
    return transaction
  } catch (error) {
    try { await release(error || true) } catch (releaseError) {
      (context.cleanupErrors ||= []).push({ phase: 'connectionRelease', error: releaseError })
    }
    if (transaction) transactionConnections.delete(transaction)
    throw error
  }
}

/**
 * @param {OwnedTransaction | null | undefined} transaction
 * @param {TransactionOutcome | undefined} outcome
 * @param {unknown} [error]
 */
export async function finishKnexTransactionConnection (transaction, outcome, error) {
  if (!transaction) return
  const release = transactionConnections.get(transaction)
  if (!release) return
  try {
    await release(outcome === 'committed' || outcome === 'rolledBack' ? undefined : error || true)
  } finally { transactionConnections.delete(transaction) }
}
