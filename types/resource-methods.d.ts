import type { Knex } from 'knex'
import type { ManagedTransactionParam } from './transactions.js'
import type {
  CollectionResult, DirectResourceId, InputResourceId, InputResourceIdentifier, ResourceFormat,
  SingleResourceResult, WriteResult, WriteReturning
} from './representations.js'

export type RemovedResourceOptions = {
  [Key in 'simplified' | 'simplifiedApi' | 'simplifiedTransport' | 'returnFullRecord' |
  'returnRecordApi' | 'returnRecordTransport' | 'isTransport']?: never
}
export interface SelectionParams {
  include?: string[]
  fields?: Record<string, string>
}
export type PageParams = { size?: number; [extension: string]: unknown } & (
  { number?: number; after?: never; before?: never } |
  { number?: never; after: string; before?: never } |
  { number?: never; after?: never; before: string }
)
export interface QueryParams extends SelectionParams {
  filters?: Record<string, unknown>
  sort?: string[]
  page?: PageParams
}
export interface TransactionParam {
  transaction?: Knex.Transaction
}
export interface JsonApiWriteDocument<Input extends object, Type extends string> {
  data: {
    type: Type
    id?: InputResourceId
    attributes?: Partial<Input>
    relationships?: Record<string, { data: InputResourceIdentifier | InputResourceIdentifier[] | null }>
  }
}
export type ResourceWriteInput<Format extends ResourceFormat, Input extends object, Type extends string> =
  Format extends 'plain' ? Partial<Input> & { id?: InputResourceId } : JsonApiWriteDocument<Input, Type>
export type ResourceWriteTarget<Format extends ResourceFormat, Input extends object, Type extends string> =
  { id: DirectResourceId; inputRecord: ResourceWriteInput<Format, Input, Type> } |
  {
    id?: never
    inputRecord: Format extends 'plain'
      ? Partial<Input> & { id: InputResourceId }
      : JsonApiWriteDocument<Input, Type> & { data: { id: InputResourceId } }
  }
export type ReadOptions<Format extends ResourceFormat> = RemovedResourceOptions & TransactionParam & {
  format?: Format
  queryParams?: SelectionParams
}
export type WriteOptions<Format extends ResourceFormat, Returning extends WriteReturning> = Omit<ReadOptions<Format>, 'transaction'> & ManagedTransactionParam & {
  returning?: Returning
}

// Defaults are the configured resource defaults, not inferred from an input body.
// Output fields and writable input fields can differ (computed/read-only fields).
export interface ResourceCoreMethods<
  Fields extends object = Record<string, unknown>,
  Input extends object = Fields,
  Type extends string = string,
  DefaultFormat extends ResourceFormat = 'plain',
  DefaultReturning extends WriteReturning = 'full',
  Context extends object = object
> {
  get<Format extends ResourceFormat = DefaultFormat>(
    params: ReadOptions<Format> & { id: DirectResourceId }, context?: Context
  ): Promise<SingleResourceResult<Format, Fields, Type>>
  query<Format extends ResourceFormat = DefaultFormat>(
    params?: RemovedResourceOptions & TransactionParam & { format?: Format; queryParams?: QueryParams }, context?: Context
  ): Promise<CollectionResult<Format, Fields, Type>>
  post<Format extends ResourceFormat = DefaultFormat, Returning extends WriteReturning = DefaultReturning>(
    params: WriteOptions<Format, Returning> & {
      inputRecord: ResourceWriteInput<NoInfer<Format>, Input, Type>
      expectedVersion?: never
    }, context?: Context
  ): Promise<WriteResult<Format, Returning, Fields, Type>>
  put<Format extends ResourceFormat = DefaultFormat, Returning extends WriteReturning = DefaultReturning>(
    params: WriteOptions<Format, Returning> & ResourceWriteTarget<NoInfer<Format>, Input, Type> & { expectedVersion?: string }, context?: Context
  ): Promise<WriteResult<Format, Returning, Fields, Type>>
  patch<Format extends ResourceFormat = DefaultFormat, Returning extends WriteReturning = DefaultReturning>(
    params: WriteOptions<Format, Returning> & ResourceWriteTarget<NoInfer<Format>, Input, Type> & { expectedVersion?: string }, context?: Context
  ): Promise<WriteResult<Format, Returning, Fields, Type>>
  delete(
    params: RemovedResourceOptions & ManagedTransactionParam & { id: DirectResourceId; format?: ResourceFormat; expectedVersion?: string }, context?: Context
  ): Promise<void>
}
