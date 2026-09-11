import type { Knex } from 'knex'
import type { StorageRow } from '../plugins/core/lib/storage/storage-types.js'
import type { TransactionOutcome } from '../types/errors.js'

export type { TransactionOutcome } from '../types/errors.js'
export type OwnedTransaction = Knex.Transaction<StorageRow, StorageRow[]>

export interface CleanupDiagnostic {
  phase: string
  error: unknown
  operationIndex?: number
  finalizerIndex?: number
  scopeName?: string
  method?: string
}

// Only the context fields used by transaction orchestration; resource stages extend it.
export interface TransactionContext {
  transaction?: OwnedTransaction
  transactionOutcome?: TransactionOutcome
  transactionCommitted?: boolean
  shouldCommit?: boolean
  error?: unknown
  cleanupErrors?: CleanupDiagnostic[]
  scopeName?: string
  method?: string
}

export type CompletionHook = (name: 'afterCommit' | 'afterRollback') => unknown | Promise<unknown>
export type TransactionFactory = (context: TransactionContext) => Promise<OwnedTransaction>
export type TransactionCallback<T> = ((transaction: OwnedTransaction) => T | Promise<T>) & {
  transaction?: OwnedTransaction
}
export interface WriteRequest {
  context: TransactionContext
  params?: { transaction?: OwnedTransaction } | TransactionCallback<unknown>
}

export interface TransactionState {
  transaction: OwnedTransaction
  owner: TransactionContext
  phase: 'pending' | 'completing' | 'finishing' | 'finished'
  failed: boolean
  error?: unknown
  participants: Array<{
    context: TransactionContext
    runHooks: CompletionHook
    operationIndex: number
    failed?: boolean
  }>
  contexts: Set<TransactionContext>
  finalizers: Array<() => unknown | Promise<unknown>>
  inFlight: Map<TransactionContext, {
    promise: Promise<void>
    resolve: () => void
    reject: (reason?: unknown) => void
  }>
  onQueryError?: (error: unknown) => void
}
