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
