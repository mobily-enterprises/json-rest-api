import type { JsonApiDocument, JsonApiLinks, JsonApiRelationship, JsonApiResource } from '../../../../types/representations.js'
import type { SelectionParams } from '../../../../types/resource-methods.js'
import { RELATIONSHIPS_KEY } from '../querying-writing/knex-constants.js'
import { queryConstraint } from '../querying/query-constraint.js'
import type { TransactionContext } from '../../../../lib/transaction-types.js'
import type { Knex } from 'knex'

// Internal boundary types. Values remain unknown until their schema/driver owns conversion.
export type StorageRow = Record<string, unknown>
export type StorageQuery = Knex.QueryBuilder<StorageRow, StorageRow[]>
export type StorageDatabase = Knex<StorageRow, StorageRow[]>
export interface MandatoryQueryConstraint {
  scopeName: string
  values?: StorageRow
  idsQuery?: StorageQuery
}
export type SelectColumn = string | Knex.Raw<unknown> | StorageQuery | Record<string, string>
export type SelectColumns = SelectColumn[] | Record<string, string> | null | undefined
export type SelectTranslator = (field: string, alias?: string | null) => string
export type StorageNaming = 'snake_case' | 'exact'

export interface StorageConfig {
  naming?: 'snake' | 'snake_case' | 'snakeCase' | 'exact' | 'field' | 'verbatim'
  [option: string]: unknown
}

export interface StorageContext {
  scopeName?: string
  [key: string]: unknown
}

export interface StorageWriteOptions {
  context?: StorageContext | null
  operation?: string | null
  databaseClient?: string
}

export interface StorageSerializerDetails extends StorageWriteOptions {
  fieldName?: string
  columnName?: string
  definition: StorageFieldDefinition
  schemaInfo?: Partial<StorageSchemaInfo>
}

export interface StorageFieldDefinition {
  type?: string
  dataType?: string
  temporalPrecision?: number
  virtual?: boolean
  computed?: boolean
  hidden?: boolean
  normallyHidden?: boolean
  belongsTo?: string
  as?: string
  belongsToPolymorphic?: unknown
  actualField?: string
  isRelationship?: boolean
  storage?: {
    column?: string
    serialize?: (value: unknown, details: StorageSerializerDetails) => unknown
  }
  [option: string]: unknown
}

export interface FieldStorage {
  column: string
  serialize: NonNullable<StorageFieldDefinition['storage']>['serialize'] | null
  persisted: boolean
  definition: StorageFieldDefinition
}

export interface StorageInfo {
  idColumn: string
  storage: StorageConfig & { naming: StorageNaming }
  fields: Record<string, FieldStorage>
  columns: Record<string, string>
}

export interface CanonicalFieldSlot {
  slot: string
  slotType: string
  alias?: string
}

export interface CanonicalDescriptor {
  tenant: string
  resource: string
  idProperty?: string
  canonical: {
    tableName: string
    tenantColumn: string
    resourceColumn: string
    logicalIdColumn?: string
  }
  fields?: Record<string, CanonicalFieldSlot>
  schema?: Record<string, StorageFieldDefinition>
  reverseAttributes?: Record<string, string>
  canonicalFieldMap?: Record<string, string | {
    slot?: string
    slotColumn?: string
    idSlot?: string
    typeSlot?: string
  }>
  belongsTo?: Record<string, { idColumn: string; typeColumn: string; target: string }>
  polymorphicBelongsTo?: Record<string, {
    typeField: string
    idField: string
    typeColumn?: string
    idColumn?: string
    types: string[]
  }>
}

export interface StorageSchemaInfo {
  tableName: string
  idProperty?: string
  schemaStructure: Record<string, StorageFieldDefinition>
  searchSchemaStructure?: Record<string, StorageFieldDefinition>
  computed?: Record<string, StorageFieldDefinition>
  storage?: StorageConfig
  storageInfo?: StorageInfo
  descriptor?: CanonicalDescriptor
}

export interface ResourceConversionSchema extends StorageSchemaInfo {
  foreignKeyFields: ReadonlySet<string>
  schemaRelationships?: Record<string, StorageFieldDefinition & {
    belongsToPolymorphic?: { typeField: string; idField: string; types?: readonly string[] }
  }>
}

export interface ResourceConversionScope {
  vars: { schemaInfo: ResourceConversionSchema }
}

export interface StorageAdapter {
  isCanonical(): boolean
  getTableName(): string
  getIdColumn(): string
  translateColumn(field: string): string
  translateFilterValue(field: string, value: unknown): unknown
  translateCursorValue(field: string, value: unknown): unknown
  applyResourceScope(query: StorageQuery, tableAlias?: string): StorageQuery
  toStorageRow(attributes: StorageRow, options?: StorageWriteOptions): StorageRow
  getFieldValue(record: StorageRow | null | undefined, fieldName: string): unknown
  // Some internal callers pass a Knex instance through this option; neither handle is owned here.
  buildBaseQuery(options?: { transaction?: StorageDatabase | null; tableAlias?: string }): StorageQuery
  selectColumns(builder: StorageQuery, columns: SelectColumns): StorageQuery
}

export interface StorageAdapterOptions {
  knex: StorageDatabase
  schemaInfo: StorageSchemaInfo
}

export interface BaseStorageAdapterOptions {
  knex: StorageDatabase
  tableName: string
  idColumn: string
  translateColumn: StorageAdapter['translateColumn']
  translateFilterValue?: StorageAdapter['translateFilterValue']
  translateCursorValue?: StorageAdapter['translateCursorValue']
  applyResourceScope?: StorageAdapter['applyResourceScope']
  toStorageRow?: StorageAdapter['toStorageRow']
  getFieldValue?: StorageAdapter['getFieldValue']
  isCanonical?: boolean
}

export interface StorageHookParams {
  context?: {
    knexQuery?: { scopeName?: string; tableName?: string; storageAdapter?: StorageAdapter }
    storageAdapter?: StorageAdapter
  }
}

export interface StorageResource {
  vars?: { schemaInfo?: StorageSchemaInfo; storageAdapter?: StorageAdapter }
}

export interface StorageAdapterLookupOptions {
  knex: StorageDatabase
  getResource: (scopeName: string) => StorageResource | null | undefined
}

// Hook state may be cleared; entering filtering always requires a live builder.
export interface QueryFilteringState {
  query?: StorageQuery | null
  filters?: Record<string, unknown>
  schemaInfo?: StorageSchemaInfo
  scopeName?: string
  tableName?: string
  db?: StorageDatabase
  queryPurpose?: string
  adapter?: StorageAdapter
  storageAdapter?: StorageAdapter
  isAnyApi?: boolean
}

// Attributes have passed setters; their values need not be public JSON values.
export interface StorageInputRecord {
  data: {
    id?: string | number
    type?: string
    attributes?: StorageRow
    relationships?: Record<string, unknown>
  }
}

export interface DataWriteContext extends TransactionContext, StorageContext {
  db: StorageDatabase
  schemaInfo: DataOperationSchema
  storageAdapter?: StorageAdapter
  inputRecord: StorageInputRecord
}

export interface DataIdentityContext extends TransactionContext, StorageContext {
  db: StorageDatabase
  schemaInfo: DataOperationSchema
  storageAdapter?: StorageAdapter
  id: string | number
}

export interface DataWriteHelpers<UpdateResult, DeleteResult> {
  dataExists: (request: { scopeName: string, context: DataIdentityContext }) => Promise<boolean>
  // POST preserves backend-dependent insert results; do not assume a scalar type here.
  dataPost: (request: { scopeName: string, context: DataWriteContext }) => Promise<unknown>
  dataPut: (request: {
    scopeName: string
    context: DataWriteContext & DataIdentityContext & { isCreate: boolean }
  }) => Promise<UpdateResult>
  dataPatch: (request: {
    scopeName: string
    context: DataWriteContext & DataIdentityContext
  }) => Promise<UpdateResult>
  dataDelete: (request: { scopeName: string, context: DataIdentityContext }) => Promise<DeleteResult>
}

export type OrdinaryDataWriteHelpers = DataWriteHelpers<void, { success: true }>
export type CanonicalDataWriteHelpers = DataWriteHelpers<number, number>

// Read helpers assemble resource-shaped values before final output normalization.
export interface DataResource extends JsonApiResource {
  __$jsonrestapi_computed_deps$__?: string[]
}

export type DataDocument<T> = JsonApiDocument<T>

export interface DataStorageRow extends StorageRow {
  [RELATIONSHIPS_KEY]?: Record<string, JsonApiRelationship>
}

export interface DataReadContext extends TransactionContext, StorageContext {
  scopeName: string
  [queryConstraint]?: MandatoryQueryConstraint
  db: StorageDatabase
  schemaInfo: DataOperationSchema
  storageAdapter?: StorageAdapter
  id?: string | number
  queryParams?: {
    filters?: StorageRow
    fields?: SelectionParams['fields']
    include?: string[]
    sort?: string[]
    page?: { size?: number; number?: number; before?: string; after?: string }
  }
  knexQuery?: QueryFilteringState | null
  computedDependencies?: string[]
  returnMeta?: {
    queryString?: string
    paginationMeta?: object
    paginationLinks?: JsonApiLinks | null
    [key: string]: unknown
  }
  sortableFields?: string[]
}

export interface DataReadRequest {
  scopeName: string
  context: DataReadContext
  runHooks?: (name: 'knexQueryFiltering') => unknown | Promise<unknown>
}

export type QueryBuilderResult = StorageQuery | { query: QueryBuilderResult }

export interface DataMinimalRequest extends DataReadRequest {
  filters?: StorageRow
  queryPurpose?: string
  applyQueryFilters?: (params: QueryFilteringState & { query: StorageQuery }) => Promise<{ query: QueryBuilderResult } | null | undefined>
}

export interface DataMinimalReader {
  (request: DataMinimalRequest & { ids: Array<string | number> }): Promise<DataResource[]>
  (request: DataMinimalRequest & {
    ids?: undefined
    context: DataReadContext & { id: string | number }
  }): Promise<DataResource | null>
}

export interface DataReadHelpers<GetResult> {
  dataGetMinimal: DataMinimalReader
  dataGet: (request: DataReadRequest & {
    context: DataReadContext & { id: string | number }
  }) => Promise<GetResult>
  dataQuery: (request: DataReadRequest & {
    runHooks: NonNullable<DataReadRequest['runHooks']>
    context: DataReadContext & {
      queryParams: NonNullable<DataReadContext['queryParams']>
    }
  }) => Promise<DataDocument<DataResource[]>>
}

export type OrdinaryDataReadHelpers = DataReadHelpers<DataDocument<DataResource>>
export type CanonicalDataReadHelpers = DataReadHelpers<DataDocument<DataResource> | null>

export interface DatabaseInfo {
  client: string
  version: string
  error?: string
}

export interface CapabilityLogger {
  warn(message: string, details: unknown): unknown
}

export type InsertResultMode = 'insert-id' | 'rows' | 'driver-defined'

export interface TemporalStorageCapabilities {
  dateMinYear: number
  dateTimeMinYear: number
  maxYear: number
  dateTimeFractionDigits: number
  timeFractionDigits: number | null
}

export interface SchemaCapabilities {
  recognizedDialect: boolean
  fieldAlteration: 'standalone' | 'sqlite-rebuild' | 'transaction'
  callerFieldAlteration: 'forbidden' | 'foreign-keys-off' | 'savepoint'
  temporalColumnFractionDigits: number | null
  setValues: boolean
}

export interface SerializationCapabilities {
  readonly customSerializerResult: 'synchronous'
  readonly structuredTypes: readonly string[]
  readonly structuredEncoding: 'json'
  readonly wholeDocumentPredicates: false
}

export interface RelationshipCapabilities {
  readonly attributeKinds: readonly string[]
  readonly declaredCardinalities: {
    readonly hasOne: 'one'
    readonly hasMany: 'many'
    readonly manyToMany: 'many'
  }
}

export interface DatabaseCapabilities {
  dbInfo: DatabaseInfo
  windowFunctions: boolean
  insertResult: InsertResultMode
  serialization: SerializationCapabilities
  relationships: RelationshipCapabilities
  temporal: { native: TemporalStorageCapabilities; text: TemporalStorageCapabilities }
  schema: SchemaCapabilities
}

export interface PivotRelationship {
  through: string
  foreignKey: string
  otherKey: string
}

export interface RelatedQueryRequest {
  scopeName: string
  context: TransactionContext & { db: StorageDatabase; id: string | number; relationshipName: string }
  relDef: PivotRelationship
}

// Wrap thenable builders so awaiting the helper does not execute its subquery.
export type DataRelatedIdsQuery = (request: RelatedQueryRequest) => Promise<{ query: StorageQuery }>
export type CanonicalDataRelatedIdsQuery = (request: Omit<RelatedQueryRequest, 'relDef'> & { relDef?: unknown }) => Promise<{ query: StorageQuery }>

export interface CanonicalLinkContext extends TransactionContext {
  db?: StorageDatabase
  id: string | number
}

export interface CanonicalLinkRequest {
  scopeName: string
  relName: string
  context: CanonicalLinkContext
}

export interface CanonicalLinkMutation extends CanonicalLinkRequest {
  relData: Array<{ type: string; id: string | number }>
  relDef?: unknown
}

export interface CanonicalLinkHelpers {
  attachMany(request: CanonicalLinkMutation): Promise<void>
  syncMany(request: CanonicalLinkMutation & { isUpdate: boolean }): Promise<void>
  removeMany(request: CanonicalLinkMutation): Promise<void>
  listMany(request: CanonicalLinkRequest): Promise<Array<{ type: string; id: string | null }>>
  fetchManyToManyRows(request: {
    scopeName: string
    relName: string
    parentIds: Array<string | number>
    context: Omit<CanonicalLinkContext, 'id'>
  }): Promise<Array<{ parentId: string; childId: string; childType: string }>>
}

export interface DataOperationSchema extends ResourceConversionSchema {
  idProperty: string
  queryFields?: Record<string, import('../querying-writing/query-field-types.js').CompiledQueryField>
}

export interface DataOperationScope {
  checkPermissions(request: { method: 'query', originalContext: DataReadContext }): Promise<unknown>
  applyQueryFilters(request: QueryFilteringState, context: DataReadContext): Promise<{ query: QueryBuilderResult } | null | undefined>
  name?: string
  scopeName?: string
  vars: {
    schemaInfo: DataOperationSchema
    defaultSort?: string[]
    enablePaginationCounts?: boolean
    queryDefaultLimit?: number
    queryMaxLimit?: number
    [option: string]: unknown
  }
}

export interface DataOperationApi {
  resources: Record<string, DataOperationScope>
  knex: { instance: StorageDatabase }
}

export interface DataSortDescriptor {
  field: string
  direction: string
  column?: string
  resultColumn?: string
  actualField?: string
  referenceField?: string
  definition?: StorageFieldDefinition | null
  isRelationship: boolean
  queryFieldRuntime?: import('../querying-writing/query-field-types.js').ProjectionRuntime
}

export interface DataSortRequest {
  query: StorageQuery
  sort?: unknown
  schemaInfo: StorageSchemaInfo
  sortableFields?: string[]
  storageAdapter: StorageAdapter
  defaultSort?: string[]
  scopeName: string
  context: DataReadContext
  before?: boolean
  queryFieldRuntimeByField: Map<string, import('../querying-writing/query-field-types.js').ProjectionRuntime>
}

export interface OrdinaryDataDependencies {
  api: DataOperationApi
  scopes: Record<string, DataOperationScope>
  knex: StorageDatabase
  log: import('../../../../types/runtime.js').RuntimeLogger
  getScopeStorageAdapter(scopeName: string): StorageAdapter | null
}

export interface DataCursorOptions {
  schemaInfo?: StorageSchemaInfo | null
  definitions?: Record<string, StorageFieldDefinition | null | undefined>
  before?: boolean
}

export interface CanonicalDataDependencies {
  api: DataOperationApi
  knex: StorageDatabase
  getScopeStorageAdapter(scopeName: string): StorageAdapter | null
  getDescriptor(scopeName: string): CanonicalDescriptor
  linkStore: {
    invalidateDeletedLinkTargets(scopeName: string, context: DataIdentityContext): Promise<void>
    deleteResourceLinks(request: { descriptor: CanonicalDescriptor, scopeName: string, id: string | number, db: StorageDatabase }): Promise<void>
  }
  buildIncludes(request: { parentResources: DataResource[], descriptor: CanonicalDescriptor, context: DataReadContext }): Promise<DataResource[]>
  attachReverseRelationships(request: { resources: DataResource[], descriptor: CanonicalDescriptor, context: DataReadContext }): Promise<void>
  attachManyToManyRelationships(request: { resources: DataResource[], descriptor: CanonicalDescriptor, context: DataReadContext }): Promise<void>
  applyBuiltInAnyApiQueryFilters(context: DataReadContext): Promise<void>
}

export interface CanonicalDataSortRequest {
  query: StorageQuery
  sort?: string[]
  descriptor: CanonicalDescriptor
  scope: DataOperationScope
  tableAlias: string
  context: DataReadContext
  before?: boolean
  queryFieldRuntimeByField: Map<string, import('../querying-writing/query-field-types.js').ProjectionRuntime>
}
