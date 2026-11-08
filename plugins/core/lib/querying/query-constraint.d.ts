import type { MandatoryQueryConstraint, StorageAdapter, StorageQuery } from '../storage/storage-types.js'

export type { MandatoryQueryConstraint } from '../storage/storage-types.js'
export declare const queryConstraint: unique symbol

export declare function applyQueryConstraint(options: {
  query: StorageQuery
  context: { [queryConstraint]?: MandatoryQueryConstraint }
  scopeName: string
  storageAdapter: StorageAdapter
  tableName: string
}): void

export declare const writeConditions: unique symbol

/** Repeats the ownership conditions the scoped reads of `scopeName` recorded on `context`. */
export declare function applyWriteConditions<Query extends StorageQuery>(options: {
  query: Query
  context: { [writeConditions]?: Record<string, Record<string, unknown>> }
  scopeName: string
  storageAdapter: StorageAdapter
  tableName: string
}): Query

/** Whether the scope's reads under this context's constraint take shared locks: a locked constraint, on MySQL or MariaDB. */
export declare function readsLockedRows(context: { [queryConstraint]?: MandatoryQueryConstraint }, scopeName: string, db: import('knex').Knex): boolean
