import type { ManagedTransaction } from './transactions.js'
import type { TransactionOutcome } from './errors.js'
import type { DirectResourceId, InputResourceId, JsonApiResource, PlainResource, ResourceFormat, ResourceIdentifier, WriteReturning } from './representations.js'
import type { JsonApiWriteDocument, RemovedResourceOptions, ResourceWriteInput, WriteOptions } from './resource-methods.js'

export type BulkTransactionOptions<DefaultAtomic extends boolean = true> =
  { atomic: true; transaction?: ManagedTransaction } |
  { atomic: false; transaction?: never } |
  { atomic?: undefined; transaction?: DefaultAtomic extends true ? ManagedTransaction : never }
export interface BulkError {
  index: number
  id?: DirectResourceId
  status: 'error'
  error: { code: unknown; message: string; details?: unknown; transactionOutcome: TransactionOutcome }
}
export interface BulkMeta {
  total: number
  succeeded: number
  failed: number
  atomic: boolean
}
export type BulkWriteResult<Format extends ResourceFormat, Returning extends WriteReturning, Fields extends object, Type extends string> =
  { meta: BulkMeta; errors?: BulkError[] } & (Returning extends 'none'
    ? { data?: never }
    : { data: Array<Returning extends 'minimal' ? ResourceIdentifier<Type> : Format extends 'plain' ? PlainResource<Fields> : JsonApiResource<Fields, Type>> })
export interface BulkDeleteResult {
  meta: BulkMeta & { deleted: DirectResourceId[] }
  errors?: BulkError[]
}
export type BulkPostInput<Input extends object, Type extends string> =
  { data: Array<Partial<Input> & { id?: InputResourceId }>; document?: never } |
  { data?: never; document: Omit<JsonApiWriteDocument<Input, Type>, 'data'> & { data: JsonApiWriteDocument<Input, Type>['data'][] } }
export type BulkPatchInput<Input extends object, Type extends string> = {
  id: DirectResourceId
} & ResourceWriteInput<Input, Type>
export interface BulkResourceMethods<
  Fields extends object = Record<string, unknown>, Input extends object = Fields,
  Type extends string = string, DefaultFormat extends ResourceFormat = 'plain',
  DefaultReturning extends WriteReturning = 'full', DefaultAtomic extends boolean = true,
  Context extends object = object
> {
  bulkPost<Format extends ResourceFormat = DefaultFormat, Returning extends WriteReturning = DefaultReturning>(
    params: Omit<WriteOptions<Format, Returning>, 'queryParams'> & BulkTransactionOptions<DefaultAtomic> & BulkPostInput<Input, Type> & {
      expectedVersion?: never
      expectedVersions?: never
    }, context?: Context
  ): Promise<BulkWriteResult<Format, Returning, Fields, Type>>
  bulkPatch<Format extends ResourceFormat = DefaultFormat, Returning extends WriteReturning = DefaultReturning>(
    params: Omit<WriteOptions<Format, Returning>, 'queryParams'> & BulkTransactionOptions<DefaultAtomic> & {
      operations: BulkPatchInput<Input, Type>[]
      expectedVersion?: never
      expectedVersions?: string[]
    }, context?: Context
  ): Promise<BulkWriteResult<Format, Returning, Fields, Type>>
  bulkDelete(
    params: RemovedResourceOptions & BulkTransactionOptions<DefaultAtomic> & {
      ids: DirectResourceId[]
      format?: ResourceFormat
      expectedVersion?: never
      expectedVersions?: string[]
    }, context?: Context
  ): Promise<BulkDeleteResult>
}
