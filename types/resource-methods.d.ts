import type { Knex } from 'knex'
import type { ManagedTransactionParam } from './transactions.js'
import type {
  CollectionResult, DirectResourceId, InputResourceId, InputResourceIdentifier, ResourceFormat,
  SingleResourceResult, WriteResult, WriteReturning
} from './representations.js'

export type RemovedResourceOptions = {
  [Key in 'simplified' | 'simplifiedApi' | 'simplifiedTransport' | 'returnFullRecord' |
  'returnRecordApi' | 'returnRecordTransport' | 'isTransport' | 'inputRecord' | 'inputRecords']?: never
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
  meta?: Record<string, unknown>
  links?: Record<string, unknown>
  jsonapi?: Record<string, unknown>
  included?: never
  errors?: never
}
export type ResourceWriteInput<Input extends object, Type extends string> =
  { data: Partial<Input> & { id?: InputResourceId }; document?: never } |
  { data?: never; document: JsonApiWriteDocument<Input, Type> }
export type ResourceWriteTarget<Input extends object, Type extends string> =
  ({ id: DirectResourceId } & ResourceWriteInput<Input, Type>) |
  {
    id?: never
    data: Partial<Input> & { id: InputResourceId }
    document?: never
  } |
  {
    id?: never
    data?: never
    document: JsonApiWriteDocument<Input, Type> & { data: { id: InputResourceId } }
  }
export type ReadOptions<Format extends ResourceFormat> = RemovedResourceOptions & TransactionParam & {
  format?: Format
  queryParams?: SelectionParams
}
export type WriteOptions<Format extends ResourceFormat, Returning extends WriteReturning> = Omit<ReadOptions<Format>, 'transaction'> & ManagedTransactionParam & {
  returning?: Returning
}

// Format selects output only; data and document select the input representation.
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
    params: WriteOptions<Format, Returning> & ResourceWriteInput<Input, Type> & {
      expectedVersion?: never
    }, context?: Context
  ): Promise<WriteResult<Format, Returning, Fields, Type>>
  put<Format extends ResourceFormat = DefaultFormat, Returning extends WriteReturning = DefaultReturning>(
    params: WriteOptions<Format, Returning> & ResourceWriteTarget<Input, Type> & { expectedVersion?: string }, context?: Context
  ): Promise<WriteResult<Format, Returning, Fields, Type>>
  patch<Format extends ResourceFormat = DefaultFormat, Returning extends WriteReturning = DefaultReturning>(
    params: WriteOptions<Format, Returning> & ResourceWriteTarget<Input, Type> & { expectedVersion?: string }, context?: Context
  ): Promise<WriteResult<Format, Returning, Fields, Type>>
  delete(
    params: RemovedResourceOptions & ManagedTransactionParam & { id: DirectResourceId; format?: ResourceFormat; expectedVersion?: string }, context?: Context
  ): Promise<void>
}
