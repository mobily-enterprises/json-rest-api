import type { Knex } from 'knex'

declare const managedTransaction: unique symbol

// Type-only provenance: the runtime tracks ownership privately, not on this symbol.
export type ManagedTransaction = Knex.Transaction & {
  readonly [managedTransaction]: true
  commit: never
  rollback: never
  transaction: never
  savepoint: never
}
export interface ManagedTransactionParam {
  transaction?: ManagedTransaction
}
export interface TransactionMethods<Context extends object = object> {
  transaction<Result>(
    callback: (transaction: ManagedTransaction) => Result | PromiseLike<Result>,
    context?: Context
  ): Promise<Awaited<Result>>
}
