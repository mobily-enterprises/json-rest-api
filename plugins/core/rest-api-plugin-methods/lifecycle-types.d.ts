import type { TransactionContext, TransactionFactory, OwnedTransaction } from '../../../lib/transaction-types.js'
import type { ResourceFormat, WriteReturning, JsonApiDocument, JsonApiResource, ResourceIdentifier } from '../../../types/representations.js'
import type { RestApiPluginOptions } from '../../../types/plugin-options.js'
import type { RuntimeLogger } from '../../../types/runtime.js'
import type { QueryParams } from '../../../types/resource-methods.js'
import type {
  StorageDatabase, StorageSchemaInfo, StorageFieldDefinition, StorageRow, QueryFilteringState,
  DataWriteHelpers, CanonicalDataReadHelpers, DataRelatedIdsQuery, CanonicalLinkHelpers, QueryBuilderResult
} from '../lib/storage/storage-types.js'
import type { MandatoryQueryConstraint } from '../lib/querying/query-constraint.js'
import { queryConstraint } from '../lib/querying/query-constraint.js'
import { writePrecondition } from './common.js'

export type Identifier = ResourceIdentifier
export type RelationshipData = Identifier | Identifier[] | null
export interface Relationship { data?: RelationshipData }
export interface InputDocument {
  data: {
    type?: string
    id?: string | number
    attributes?: StorageRow
    relationships?: Record<string, Relationship>
  }
}
export interface Resource extends JsonApiResource { __$jsonrestapi_computed_deps$__?: string[] }
export type Document<Data = Resource | Resource[] | null> = Omit<JsonApiDocument<Data>, 'included'> & { included?: Resource[] }
export interface Field extends StorageFieldDefinition {
  compute?: (args: {
    id?: string | number
    attributes: StorageRow
    record: StorageRow
    context?: LifecycleContext
    helpers: LifecycleHelpers
    api: LifecycleApi
  }) => unknown
  belongsToPolymorphic?: { typeField: string; idField: string; types: string[] }
  through?: string
  foreignKey?: string
  otherKey?: string
  target?: string
  via?: string
}
export interface Schema {
  structure: Record<string, Field>
  create(attributes: StorageRow): Promise<ValidationResult>
  patch(attributes: StorageRow): Promise<ValidationResult>
  replace(attributes: StorageRow): Promise<ValidationResult>
}
export interface ValidationResult {
  validatedObject: StorageRow & { id?: string | number }
  errors: Record<string, { code?: string; message: string }>
}
export interface FieldCallbackContext {
  id?: string | number
  attributes: StorageRow
  fieldName: string
  originalValue: unknown
  originalAttributes: StorageRow
  record?: StorageRow
  parentContext?: LifecycleContext
  scopeName: string
  method?: string
  api: LifecycleApi
  helpers: LifecycleHelpers
  auth?: unknown
  isMainResource?: boolean
}
export interface LifecycleSchema extends StorageSchemaInfo {
  idProperty: string
  readDependencies?: Record<string, readonly string[]>
  schemaInstance: Schema
  schemaStructure: Record<string, Field>
  schemaRelationships: Record<string, Field>
  outputRelationships: Record<string, Field>
  outputFields: Record<string, Field>
  computed: Record<string, Field>
  foreignKeyFields: Set<string>
  fieldSetters: Record<string, {
    setter(value: unknown, context: FieldCallbackContext): unknown
    runSetterAfter?: string[]
  }>
  fieldGetters: Record<string, { getter(value: unknown, context: FieldCallbackContext): unknown }>
  sortedSetterFields: string[]
  sortedGetterFields: string[]
  sortedComputedFields: string[]
}

// Library-owned mutable working state, populated by each method before its stage runs.
// Attribute values stay unknown until a schema or user callback interprets them.
export interface LifecycleContext<Data = Resource | Resource[] | null, Input = InputDocument> extends TransactionContext {
  method?: string
  scopeName?: string
  schemaInfo?: LifecycleSchema
  db?: StorageDatabase
  inputRecord?: Input
  record?: Document<Data> | Record<string, never> | null
  queryParams?: QueryParams
  params?: LifecycleParams
  id?: string | number
  relationshipName?: string
  format?: ResourceFormat
  simplified?: boolean
  returning?: WriteReturning
  minimalRecord?: (Omit<Resource, 'id'> & { id?: string }) | null
  originalMinimalRecord?: Omit<Resource, 'id'> & { id?: string }
  originalInputAttributes?: StorageRow
  originalRecord?: Document
  responseRecord?: Document | StorageRow
  isCreate?: boolean
  isUpdate?: boolean
  exists?: boolean
  computedDependencies?: string[]
  returnMeta?: Record<string, unknown>
  sortableFields?: string[]
  auth?: unknown
  [customProperty: string]: unknown
  knexQuery?: QueryFilteringState | null
  [queryConstraint]?: MandatoryQueryConstraint
}
export interface LifecycleParams extends Record<string, unknown> {
  id?: unknown
  data?: StorageRow
  document?: InputDocument
  format?: ResourceFormat
  returning?: WriteReturning
  transaction?: OwnedTransaction
  queryParams?: QueryParams
  expectedVersion?: unknown
  relationshipName?: string
  relationshipData?: RelationshipData
  [queryConstraint]?: MandatoryQueryConstraint
  [writePrecondition]?: () => unknown
}
export interface LifecycleVars extends RestApiPluginOptions {
  schemaInfo: LifecycleSchema
  defaultSort?: string | string[]
  sortableFields?: string[]
}
export interface LifecycleResource {
  scopeOptions: RestApiPluginOptions
  vars: LifecycleVars
  get(params: { id?: string | number; queryParams?: QueryParams; transaction?: OwnedTransaction; format: 'jsonapi' }, context?: LifecycleContext): Promise<Document<Resource>>
  get(params: { id?: string | number; queryParams?: QueryParams; transaction?: OwnedTransaction; format: ResourceFormat }, context?: LifecycleContext): Promise<Document<Resource> | StorageRow>
  query(params: { queryParams?: QueryParams; transaction?: OwnedTransaction; format: 'jsonapi'; [queryConstraint]?: MandatoryQueryConstraint }, context?: LifecycleContext): Promise<Document<Resource[]>>
  patch(params: { id?: string | number; document: InputDocument; transaction?: OwnedTransaction; expectedVersion?: unknown; format: 'jsonapi'; returning: 'none' }, context?: LifecycleContext): Promise<void>
  checkPermissions(params: { method: string; originalContext: LifecycleContext }): Promise<unknown>
  applyQueryFilters(params: QueryFilteringState, context: LifecycleContext): Promise<{ query: QueryBuilderResult } | null | undefined>
  enrichAttributes(params: EnrichmentParams): Promise<StorageRow>
}
export interface LifecycleApi {
  resources: Record<string, LifecycleResource>
  knex: { instance: StorageDatabase }
  anyapi?: { links?: CanonicalLinkHelpers }
}
export interface LifecycleHelpers extends DataWriteHelpers<unknown, unknown>, CanonicalDataReadHelpers {
  newTransaction: TransactionFactory
  db: StorageDatabase
  dataRelatedIdsQuery: DataRelatedIdsQuery
}
export type RunHooks = (event: string) => Promise<unknown>
export interface LifecycleArguments<Data = Resource | Resource[] | null> {
  params: LifecycleParams
  context: LifecycleContext<Data>
  vars: LifecycleVars
  helpers: LifecycleHelpers
  scope: LifecycleResource
  scopes: Record<string, LifecycleResource>
  runHooks: RunHooks
  scopeOptions: RestApiPluginOptions
  scopeName: string
  api: LifecycleApi
  log: RuntimeLogger
}
export interface EnrichmentParams {
  id?: string | number
  attributes?: StorageRow
  parentContext?: LifecycleContext
  requestedComputedFields?: string[]
  isMainResource?: boolean
  computedDependencies?: string[]
}
export interface EnrichmentArguments extends Omit<LifecycleArguments, 'params' | 'context'> {
  params: EnrichmentParams
  context: Record<string, unknown> & { attributes?: StorageRow }
}

export interface RelationshipPlan {
  belongsToUpdates: StorageRow
  belongsToTargets: Identifier[]
  manyToManyRelationships: Array<{ relName: string; relDef: PivotField; relData: Identifier[] }>
  reverseRelationships: Array<{ relName: string; relDef: Field; relData: RelationshipData }>
}

// These are type views of the same object after the named stage establishes its fields.
export type ResourceContext<Input = InputDocument> = LifecycleContext<Resource | Resource[] | null, Input> & {
  method: string
  scopeName: string
  schemaInfo: LifecycleSchema
  db: StorageDatabase
}
export type IdentityContext = ResourceContext & { id: string | number }
export type RelationshipContext = IdentityContext & { id: string; relationshipName: string }
export type WriteRelationshipContext = RelationshipContext & { transaction: OwnedTransaction }
export type ReadContext<Data = Resource | Resource[] | null> = ResourceContext & {
  format: ResourceFormat
  simplified: boolean
  queryParams: QueryParams
  record?: Document<Data> | null
}
export type QueryContext = ReadContext<Resource[]> & { queryParams: QueryParams & { sort: string[] } }
export type ProcessingContext = ResourceContext<unknown> & {
  inputRecord: object
  params: LifecycleParams
  queryParams: QueryParams
  format: ResourceFormat
  simplified: boolean
  returning: WriteReturning
  transaction: OwnedTransaction
}
export type WriteContext = ProcessingContext & { inputRecord: InputDocument }
export type CompletedWriteContext = WriteContext & { id: string | number }
export type PivotField = Field & { through: string; foreignKey: string; otherKey: string }

export type RelationshipArguments = LifecycleArguments & { params: LifecycleParams & { relationshipName: string } }
export type RelationshipWriteArguments<Data = RelationshipData> = RelationshipArguments & { params: LifecycleParams & { relationshipData: Data } }
