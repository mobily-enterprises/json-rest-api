import type { StorageAdapter, StorageDatabase, StorageQuery } from '../plugins/core/lib/storage/storage-types.js'

export interface RowPolicyParams<Context extends object = Record<string, unknown>, Api extends object = object> {
  query: StorageQuery
  context: Context
  scopeName: string
  tableName?: string
  queryPurpose: string
  db?: StorageDatabase
  isAnyApi: boolean
  storageAdapter?: StorageAdapter | null
  column(field: string, options?: { scopeName?: string; alias?: string | null }): string
  value(field: string, rawValue: unknown, options?: { scopeName?: string }): unknown
  api: Api
}

export type RowPolicy<Context extends object = Record<string, unknown>, Api extends object = object> = (
  params: RowPolicyParams<Context, Api>
) => boolean | PromiseLike<boolean>

export interface RowPolicyPluginOptions<Context extends object = Record<string, unknown>, Api extends object = object> {
  policies?: Record<string, RowPolicy<Context, Api>>
}

export type ResourceRowPolicy<Context extends object = Record<string, unknown>, Api extends object = object> =
  string | RowPolicy<Context, Api> | false | null

export interface RowPolicyRegistry {
  getConfig(): { policies: string[] }
  getScopeConfig(scopeName: string): { policy: string; source: 'inline' | 'registry' } | null
}
