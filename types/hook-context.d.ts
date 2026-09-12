import type { Knex } from 'knex'
import type { CleanupDiagnostic } from '../lib/transaction-types.js'
import type { StorageAdapter } from '../plugins/core/lib/storage/storage-types.js'
import type { TransactionOutcome } from './errors.js'
import type { DirectResourceId, InputResourceId, InputResourceIdentifier, JsonApiDocument, JsonApiResource, PlainResource, ResourceFormat, WriteReturning } from './representations.js'
import type { JsonApiWriteDocument, QueryParams } from './resource-methods.js'
import type { RuntimeArguments } from './runtime.js'
import type { ManagedTransaction } from './transactions.js'

interface LibraryHookFields {
  readonly method?: string
  readonly scopeName?: string
  readonly id?: DirectResourceId
  readonly relationshipName?: string
  readonly isUpdate?: boolean
  readonly schemaInfo?: Readonly<Record<string, unknown>>
  readonly params?: Readonly<Record<string, unknown>>
  readonly queryParams?: Readonly<QueryParams>
  readonly format?: ResourceFormat
  readonly returning?: WriteReturning
  readonly simplified?: boolean
  readonly transaction?: Knex.Transaction
  readonly db?: Knex | Knex.Transaction
  readonly shouldCommit?: boolean
  readonly transactionOutcome?: TransactionOutcome
  readonly transactionCommitted?: boolean
  readonly error?: unknown
  readonly cleanupErrors?: readonly CleanupDiagnostic[]
  readonly minimalRecord?: unknown
  readonly originalMinimalRecord?: unknown
  readonly originalInputAttributes?: Readonly<Record<string, unknown>>
  readonly originalRecord?: unknown
  readonly inputRecord?: unknown
  readonly record?: unknown
  readonly responseRecord?: unknown
  readonly knexQuery?: Knex.QueryBuilder
  readonly storageAdapter?: StorageAdapter
}

// Readonly marks library ownership; it does not freeze runtime context or nested objects.
type ContextWithFields<Context extends object, Fields extends object> =
  Omit<Context, keyof LibraryHookFields | 'originalContext' | 'parentContext' | 'attributes'> &
  Omit<LibraryHookFields, keyof Fields> & Fields

export type HookContext<Context extends object = Record<string, unknown>> = ContextWithFields<Context, LibraryHookFields>

type WriteMethod = 'post' | 'put' | 'patch'
type ReadMethod = 'get' | 'query'
type RelationshipMethod = 'getRelationship' | 'getRelated' | 'postRelationship' | 'patchRelationship' | 'deleteRelationship'

// Early processing receives an object, but its document structure is not validated yet.
interface ProcessingFields<Method extends WriteMethod> {
  readonly method: Method
  readonly scopeName: string
  readonly format: ResourceFormat
  readonly returning: WriteReturning
  readonly transaction: ManagedTransaction
  readonly inputRecord: Record<string, unknown>
}
export type ProcessingHookContext<Context extends object = Record<string, unknown>, Method extends WriteMethod = WriteMethod> =
  ContextWithFields<Context, ProcessingFields<Method>>

// Identity and relationship planning are fixed before the schema-validation hooks.
type HookWriteDocument = Omit<JsonApiWriteDocument<Record<string, unknown>, string>, 'data'> & {
  readonly data: {
    readonly type: string
    readonly id?: InputResourceId
    attributes?: Record<string, unknown>
    readonly relationships?: Readonly<Record<string, {
      readonly data: Readonly<InputResourceIdentifier> | readonly Readonly<InputResourceIdentifier>[] | null
    }>>
  }
}

// The document structure is checked here; individual attribute values remain unknown.
interface WriteFields<Method extends WriteMethod> extends Omit<ProcessingFields<Method>, 'inputRecord'> {
  readonly inputRecord: HookWriteDocument
}
export type WriteHookContext<Context extends object = Record<string, unknown>, Method extends WriteMethod = WriteMethod> =
  ContextWithFields<Context, WriteFields<Method>>

export type WriteFinishHookContext<Context extends object = Record<string, unknown>, Method extends WriteMethod = WriteMethod> =
  ContextWithFields<Context, Omit<WriteFields<Method>, 'format'> & (
    { readonly format: 'plain'; responseRecord?: PlainResource } |
    { readonly format: 'jsonapi'; responseRecord?: JsonApiDocument<JsonApiResource> }
  )>

interface ReadFields<Method extends ReadMethod> {
  readonly method: Method
  readonly scopeName: string
  readonly format: ResourceFormat
}
export type ReadHookContext<Context extends object = Record<string, unknown>, Method extends ReadMethod = ReadMethod> =
  ContextWithFields<Context, ReadFields<Method>>

export type ReadResultHookContext<Context extends object = Record<string, unknown>, Method extends ReadMethod = ReadMethod> =
  ContextWithFields<Context, ReadFields<Method> & {
    record: JsonApiDocument<Method extends 'get' ? JsonApiResource : JsonApiResource[]>
  }>

export type RelationshipHookContext<Context extends object = Record<string, unknown>, Method extends RelationshipMethod = RelationshipMethod> =
  HookContext<Context> & {
    readonly method: Method
    readonly id: DirectResourceId
    readonly relationshipName: string
    readonly originalContext?: undefined
  }

// CRUD permission checks use a wrapper; relationship hooks receive their operation directly.
export type PermissionHookContext<Context extends object = Record<string, unknown>> =
  (Record<string, unknown> & { readonly method: string; readonly originalContext: HookContext<Context> }) |
  RelationshipHookContext<Context>

export type EnrichmentHookContext<Context extends object = Record<string, unknown>> = {
  readonly parentContext: ReadResultHookContext<Context>
  readonly scopeName: string
  readonly computedFields: Readonly<Record<string, unknown>>
  readonly requestedComputedFields: readonly string[]
  attributes: Record<string, unknown>
  [customProperty: string]: unknown
}

export interface HookContextMap<Context extends object = Record<string, unknown>> {
  beforeProcessing: ProcessingHookContext<Context>
  beforeProcessingPost: ProcessingHookContext<Context, 'post'>
  beforeProcessingPut: ProcessingHookContext<Context, 'put'>
  beforeProcessingPatch: ProcessingHookContext<Context, 'patch'>
  beforeSchemaValidate: WriteHookContext<Context>
  beforeSchemaValidatePost: WriteHookContext<Context, 'post'>
  beforeSchemaValidatePut: WriteHookContext<Context, 'put'>
  beforeSchemaValidatePatch: WriteHookContext<Context, 'patch'>
  afterSchemaValidate: WriteHookContext<Context>
  afterSchemaValidatePost: WriteHookContext<Context, 'post'>
  afterSchemaValidatePut: WriteHookContext<Context, 'put'>
  afterSchemaValidatePatch: WriteHookContext<Context, 'patch'>
  beforeDataCall: HookContext<Context>
  beforeDataCallPost: WriteHookContext<Context, 'post'>
  beforeDataCallPut: WriteHookContext<Context, 'put'>
  beforeDataCallPatch: WriteHookContext<Context, 'patch'>
  beforeDataCallDelete: HookContext<Context> & { readonly method: 'delete'; readonly id: DirectResourceId }
  beforeDataCallPostRelationship: RelationshipHookContext<Context, 'postRelationship'>
  beforeDataCallDeleteRelationship: RelationshipHookContext<Context, 'deleteRelationship'>
  afterDataCall: HookContext<Context>
  afterDataCallPost: WriteHookContext<Context, 'post'> & { readonly id: DirectResourceId }
  afterDataCallPut: WriteHookContext<Context, 'put'> & { readonly id: DirectResourceId }
  afterDataCallPatch: WriteHookContext<Context, 'patch'> & { readonly id: DirectResourceId }
  afterDataCallDelete: HookContext<Context> & { readonly method: 'delete'; readonly id: DirectResourceId }
  beforeData: ReadHookContext<Context>
  beforeDataGet: ReadHookContext<Context, 'get'>
  beforeDataQuery: ReadHookContext<Context, 'query'>
  checkPermissions: PermissionHookContext<Context>
  checkPermissionsGetRelationship: RelationshipHookContext<Context, 'getRelationship'>
  checkPermissionsGetRelated: RelationshipHookContext<Context, 'getRelated'>
  checkPermissionsPostRelationship: RelationshipHookContext<Context, 'postRelationship'>
  checkPermissionsPatchRelationship: RelationshipHookContext<Context, 'patchRelationship'>
  checkPermissionsDeleteRelationship: RelationshipHookContext<Context, 'deleteRelationship'>
  checkDataPermissions: ReadResultHookContext<Context, 'get'>
  checkDataPermissionsGet: ReadResultHookContext<Context, 'get'>
  enrichRecord: ReadResultHookContext<Context>
  enrichRecordWithRelationships: ReadResultHookContext<Context, 'get'>
  enrichAttributes: EnrichmentHookContext<Context>
  finish: HookContext<Context>
  finishPost: WriteFinishHookContext<Context, 'post'>
  finishPut: WriteFinishHookContext<Context, 'put'>
  finishPatch: WriteFinishHookContext<Context, 'patch'>
  finishGet: ReadResultHookContext<Context, 'get'>
  finishQuery: ReadResultHookContext<Context, 'query'>
  finishDelete: HookContext<Context> & { readonly method: 'delete'; readonly id: DirectResourceId }
  finishPostRelationship: RelationshipHookContext<Context, 'postRelationship'>
  finishPatchRelationship: RelationshipHookContext<Context, 'patchRelationship'>
  finishDeleteRelationship: RelationshipHookContext<Context, 'deleteRelationship'>
  afterCommit: HookContext<Context>
  afterRollback: HookContext<Context>
}

export type KnownHookName = keyof HookContextMap
export type HookArguments<Event extends KnownHookName, Context extends object = Record<string, unknown>> =
  Omit<RuntimeArguments, 'context'> & { context: HookContextMap<Context>[Event] }
export type HookHandler<Event extends KnownHookName, Context extends object = Record<string, unknown>> =
  (args: HookArguments<Event, Context>) => unknown
