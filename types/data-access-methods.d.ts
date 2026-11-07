import type { Knex } from 'knex'
import type { ManagedTransaction } from './transactions.js'
import type { DirectResourceId, InputResourceId, JsonApiResource, PlainResource, ResourceFormat, ResourceIdentifier } from './representations.js'
import type { JsonApiWriteDocument, QueryParams, RemovedResourceOptions, SelectionParams } from './resource-methods.js'

// Many-row writes return nothing by default; 'minimal' returns identifiers, 'full' the records.
export type ManyRowReturning = 'none' | 'minimal' | 'full'
export type ManyRowResult<Format extends ResourceFormat, Returning extends ManyRowReturning, Fields extends object, Type extends string> =
  Returning extends 'none' ? void
    : { data: Array<Returning extends 'minimal' ? ResourceIdentifier<Type> : Format extends 'plain' ? PlainResource<Fields> : JsonApiResource<Fields, Type>> }
export type RecordsResult<Format extends ResourceFormat, Fields extends object, Type extends string> =
  { data: Array<Format extends 'plain' ? PlainResource<Fields> : JsonApiResource<Fields, Type>>; included?: JsonApiResource[] }
// knex.raw values: accepted by many-row patches for stored, non-relationship fields.
export type RawValue = Knex.Raw
// Ids outside the caller's scope (or missing) throw RestApiRecordsNotFoundError, or are skipped.
export type MissingRows = 'throw' | 'skip'

export interface ManyRowWriteOptions<Format extends ResourceFormat, Returning extends ManyRowReturning> extends RemovedResourceOptions {
  transaction?: ManagedTransaction
  format?: Format
  returning?: Returning
  // Rows per statement (default 500), lowered further to the dialect's parameter limit.
  chunkSize?: number
  queryParams?: SelectionParams
}
export type ManyRowCreateInput<Input extends object, Type extends string> =
  { data: Array<Partial<Input> & { id?: InputResourceId }>; document?: never } |
  { data?: never; document: { data: Array<JsonApiWriteDocument<Input, Type>['data']> } }
export interface UpsertOptions<Input extends object> {
  // Must include every ownership (autofilter) field.
  keys: Array<keyof Input & string>
  action: 'ignore' | 'merge'
  // merge only: fields to update; default every stored field the rows supply but the keys.
  merge?: Array<keyof Input & string>
}
type Patchable<Input extends object> = { [Field in keyof Input]?: Input[Field] | RawValue }
export type ManyRowPatchInput<Input extends object, Type extends string> =
  { data: Array<Patchable<Input> & { id: DirectResourceId }>; document?: never } |
  { data?: never; document: { data: Array<JsonApiWriteDocument<Input, Type>['data'] & { id: DirectResourceId }> } }
export type SharedPatchInput<Input extends object, Type extends string> =
  { data: Patchable<Input> & { id?: never }; document?: never } |
  { data?: never; document: { data: Omit<JsonApiWriteDocument<Input, Type>['data'], 'id'> } }
export interface PatchConditionOptions<Input extends object> {
  // Compare-and-set: only rows whose stored values equal these are changed; the result lists them.
  onlyIf?: { [Field in keyof Input]?: Input[Field] | null }
  missing?: MissingRows
}

export interface ScopedQueryParams {
  transaction?: Knex.Transaction
  // Table alias for column references; default the table name.
  alias?: string
  // report (default) sees shared rows; bulk-write, lock and claim see only the owner's.
  purpose?: 'report' | 'bulk-write' | 'lock' | 'claim'
  filters?: Record<string, unknown>
}
// A Knex builder that refuses writes, locks, table changes and clearing its predicates.
export type ReadOnlyQueryBuilder = Knex.QueryBuilder

export interface DataAccessMethods<
  Fields extends object = Record<string, unknown>,
  Input extends object = Fields,
  Type extends string = string,
  DefaultFormat extends ResourceFormat = 'plain',
  Context extends object = object
> {
  // Resolves to { query }: a builder is thenable, so it cannot be the promise's value.
  scopedQuery(params?: ScopedQueryParams, context?: Context): Promise<{ query: ReadOnlyQueryBuilder }>
  queryAll<Format extends ResourceFormat = DefaultFormat>(params?: {
    transaction?: Knex.Transaction
    format?: Format
    queryParams?: Omit<QueryParams, 'page'>
    // Rows per page (default 1000).
    pageSize?: number
    // Throws RestApiRowLimitError past this many rows.
    rowLimit?: number
  }, context?: Context): Promise<RecordsResult<Format, Fields, Type>>
  postMany<Format extends ResourceFormat = DefaultFormat, Returning extends ManyRowReturning = 'none'>(
    params: ManyRowWriteOptions<Format, Returning> & ManyRowCreateInput<Input, Type> & { onConflict?: UpsertOptions<Input> },
    context?: Context
  ): Promise<ManyRowResult<Format, Returning, Fields, Type>>
  patchMany<Format extends ResourceFormat = DefaultFormat, Returning extends ManyRowReturning = 'none'>(
    params: ManyRowWriteOptions<Format, Returning> & ManyRowPatchInput<Input, Type> & PatchConditionOptions<Input>,
    context?: Context
  ): Promise<ManyRowResult<Format, Returning, Fields, Type>>
  patchWhereIds<Format extends ResourceFormat = DefaultFormat, Returning extends ManyRowReturning = 'none'>(
    params: ManyRowWriteOptions<Format, Returning> & SharedPatchInput<Input, Type> & PatchConditionOptions<Input> & { ids: DirectResourceId[] },
    context?: Context
  ): Promise<ManyRowResult<Format, Returning, Fields, Type>>
  patchWhere<Format extends ResourceFormat = DefaultFormat, Returning extends ManyRowReturning = 'none'>(
    params: ManyRowWriteOptions<Format, Returning> & SharedPatchInput<Input, Type> & Omit<PatchConditionOptions<Input>, 'missing'> & { filters?: Record<string, unknown> },
    context?: Context
  ): Promise<ManyRowResult<Format, Returning, Fields, Type>>
  deleteMany<Returning extends 'none' | 'minimal' = 'none'>(
    params: RemovedResourceOptions & { ids: DirectResourceId[]; transaction?: ManagedTransaction; returning?: Returning; chunkSize?: number; missing?: MissingRows },
    context?: Context
  ): Promise<Returning extends 'none' ? void : { data: ResourceIdentifier<Type>[] }>
  deleteWhere<Returning extends 'none' | 'minimal' = 'none'>(
    params: RemovedResourceOptions & { filters?: Record<string, unknown>; transaction?: ManagedTransaction; returning?: Returning; chunkSize?: number },
    context?: Context
  ): Promise<Returning extends 'none' ? void : { data: ResourceIdentifier<Type>[] }>
  // Locks the visible rows among ids (FOR UPDATE, id order) until the transaction ends.
  lockByIds<Format extends ResourceFormat = DefaultFormat>(params: {
    ids: DirectResourceId[]
    transaction: ManagedTransaction | Knex.Transaction
    missing?: MissingRows
    format?: Format
    queryParams?: { fields?: Record<string, string> }
  }, context?: Context): Promise<RecordsResult<Format, Fields, Type>>
  // Takes up to limit (default 1, at most 1000) matching rows no other transaction holds.
  claim<Format extends ResourceFormat = DefaultFormat>(params: {
    transaction: ManagedTransaction | Knex.Transaction
    filters?: Record<string, unknown>
    // Stored fields, '-' for descending; default ['id'].
    sort?: string[]
    limit?: number
    format?: Format
    queryParams?: { fields?: Record<string, string> }
  }, context?: Context): Promise<RecordsResult<Format, Fields, Type>>
}
