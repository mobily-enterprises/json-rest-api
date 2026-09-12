export * from './types/errors.js'
export * from './types/file-storage.js'
export type * from './types/representations.js'
export type * from './types/resource-methods.js'
export type * from './types/relationship-methods.js'
export type * from './types/bulk-methods.js'
export type { ManagedTransaction, ManagedTransactionParam, TransactionMethods } from './types/transactions.js'
export type * from './types/plugin-options.js'
export type * from './types/file-detectors.js'
export type * from './types/fastify-options.js'
export type * from './types/row-policy.js'
export type * from './types/autofilter.js'

export { JsonRestApi } from './types/runtime.js'
export type * from './types/runtime.js'
export type * from './types/resource-schema.js'
export type * from './types/hook-context.js'
import type { LibraryPlugin } from './types/runtime.js'

export const RestApiPlugin: LibraryPlugin<'rest-api'>
export const AutoFilterPlugin: LibraryPlugin<'autofilter'>
export const RowPolicyPlugin: LibraryPlugin<'row-policy'>
export const QueryProjectionsPlugin: LibraryPlugin<'query-projections'>
export const FileHandlingPlugin: LibraryPlugin<'file-handling'>
export const CorsPlugin: LibraryPlugin<'rest-api-cors'>
export const LabelPlugin: LibraryPlugin<'rest-api-label'>
export const SocketIOPlugin: LibraryPlugin<'socketio'>
export const RestApiKnexPlugin: LibraryPlugin<'rest-api-knex'>
export const RestApiAnyapiKnexPlugin: LibraryPlugin<'rest-api-anyapi-knex'>
export const ExpressPlugin: LibraryPlugin<'express'>
export const FastifyPlugin: LibraryPlugin<'fastify'>

export function getUrlPrefix(
  context?: { urlPrefixOverride?: string; urlPrefix?: string } | null,
  scope?: { vars?: { transport?: { publicBaseUrl?: string; mountPath?: string } } } | null
): string
