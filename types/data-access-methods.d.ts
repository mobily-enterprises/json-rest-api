import type { Knex } from 'knex'
import type { ManagedTransaction } from './transactions.js'
import type { DirectResourceId, InputResourceId, JsonApiResource, PlainResource, ResourceFormat, ResourceIdentifier } from './representations.js'
import type { JsonApiWriteDocument, QueryParams, RemovedResourceOptions, SelectionParams } from './resource-methods.js'

// Many-row writes return nothing by default; 'minimal' returns identifiers, 'full' the records,
// 'count' the number of rows written.
export type ManyRowReturning = 'none' | 'minimal' | 'full' | 'count'
export type ManyRowCount = { meta: { count: number } }
export type ManyRowResult<Format extends ResourceFormat, Returning extends ManyRowReturning, Fields extends object, Type extends string> =
  Returning extends 'none' ? void
    : Returning extends 'count' ? ManyRowCount
    : { data: Array<Returning extends 'minimal' ? ResourceIdentifier<Type> : Format extends 'plain' ? PlainResource<Fields> : JsonApiResource<Fields, Type>> }
type DeleteResult<Returning extends 'none' | 'minimal' | 'count', Type extends string> =
  Returning extends 'none' ? void : Returning extends 'count' ? ManyRowCount : { data: ResourceIdentifier<Type>[] }
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
  // Must include every ownership (autofilter) field, and no two rows may repeat a key. An ignore's
  // rows may carry the ids they insert with; a merge's may not, since its keys identify the row.
  // ['id'] (or the idProperty) alone is allowed on a resource without ownership fields or a
  // row policy; every row then carries its id.
  keys: Array<keyof Input & string> | ['id']
  // merge also runs the patch permission checks on every row it updates.
  action: 'ignore' | 'merge'
  // merge only: fields to update; default every stored field the rows supply but the keys.
  merge?: Array<keyof Input & string>
}
// The row lock of a lock read or patchWhere: 'update' (default) is FOR UPDATE. 'noKeyUpdate'
// is FOR NO KEY UPDATE on PostgreSQL, which lets other transactions insert or change rows whose
// foreign keys reference the locked ones; MySQL, MariaDB and SQLite take FOR UPDATE for it.
export type ExclusiveLockMode = 'update' | 'noKeyUpdate'
// lockByIds and lockWhere also take 'share': FOR SHARE (LOCK IN SHARE MODE on MySQL and MariaDB),
// which other readers and shared locks pass and writes and exclusive locks wait for. Never write
// a row the same transaction holds shared: two transactions doing so deadlock.
export type LockMode = ExclusiveLockMode | 'share'
// patchWhere and deleteWhere need filters, or all: true to act on every visible row.
export type WhereScope = { filters: Record<string, unknown>; all?: never } | { filters?: never; all: true }
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
// A Knex builder over a derived table of the scoped rows. It refuses writes, locks,
// table changes, set operations, common table expressions and access to the client.
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
    params: ManyRowWriteOptions<Format, Returning> & SharedPatchInput<Input, Type> & Omit<PatchConditionOptions<Input>, 'missing'> & WhereScope & { lockMode?: ExclusiveLockMode },
    context?: Context
  ): Promise<ManyRowResult<Format, Returning, Fields, Type>>
  deleteMany<Returning extends 'none' | 'minimal' | 'count' = 'none'>(
    params: RemovedResourceOptions & { ids: DirectResourceId[]; transaction?: ManagedTransaction; returning?: Returning; chunkSize?: number; missing?: MissingRows },
    context?: Context
  ): Promise<DeleteResult<Returning, Type>>
  // Deletes the rows its selection finds and answers with those it deleted; it never throws for missing rows.
  deleteWhere<Returning extends 'none' | 'minimal' | 'count' = 'none'>(
    params: RemovedResourceOptions & WhereScope & { transaction?: ManagedTransaction; returning?: Returning; chunkSize?: number },
    context?: Context
  ): Promise<DeleteResult<Returning, Type>>
  // Locks the visible rows among ids (FOR UPDATE, or the lockMode's lock; id order) until the transaction ends.
  lockByIds<Format extends ResourceFormat = DefaultFormat>(params: {
    ids: DirectResourceId[]
    transaction: ManagedTransaction | Knex.Transaction
    missing?: MissingRows
    lockMode?: LockMode
    format?: Format
    queryParams?: { fields?: Record<string, string> }
  }, context?: Context): Promise<RecordsResult<Format, Fields, Type>>
  // Locks the visible rows the filters select (FOR UPDATE; id order, on MySQL the
  // order of the forced index, which starts with the ownership or a filtered column),
  // waiting for other transactions; throws RestApiRowLimitError past 1000 rows.
  // With sort or limit it locks them in sort order, then id (id alone with limit
  // only), and takes the first limit of them; on MySQL and MariaDB on an index that
  // reads in that order. after pages in id order: only the rows after that id.
  lockWhere<Format extends ResourceFormat = DefaultFormat>(params: {
    transaction: ManagedTransaction | Knex.Transaction
    filters?: Record<string, unknown>
    // Stored fields, '-' for descending.
    sort?: string[]
    // 1 to 1000.
    limit?: number
    // The id of the last row the previous page locked; takes no sort.
    after?: DirectResourceId
    lockMode?: LockMode
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
    lockMode?: ExclusiveLockMode
    format?: Format
    queryParams?: { fields?: Record<string, string> }
  }, context?: Context): Promise<RecordsResult<Format, Fields, Type>>
}
