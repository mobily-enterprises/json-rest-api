import type { Knex } from 'knex'
import type { StorageAdapter, StorageContext, StorageDatabase, StorageFieldDefinition, StorageRow, StorageSchemaInfo } from '../storage/storage-types.js'

export type ProjectionExpression = Knex.Raw<unknown> | Knex.QueryBuilder<StorageRow, unknown>

export interface ProjectionContext {
  knex: StorageDatabase | null
  db: StorageDatabase | null
  context: StorageContext | null
  scopeName: string
  tableName: string
  fieldName: string
  schemaInfo: Partial<StorageSchemaInfo>
  adapter: StorageAdapter | null
  column: (logicalField: string) => string
  ref: (logicalField: string) => string | Knex.Ref<string, Record<string, string>>
}

export type ProjectionSelector = (context: ProjectionContext) => ProjectionExpression

export interface QueryFieldDeclaration extends StorageFieldDefinition {
  select?: ProjectionSelector
  project?: ProjectionSelector
  sortable?: boolean
}

export interface CompiledQueryField extends QueryFieldDeclaration {
  select: ProjectionSelector
  sortable: boolean
  hidden: boolean
  normallyHidden: boolean
}

export interface QueryFieldCompilation {
  scopeName: string
  schemaStructure: Record<string, StorageFieldDefinition>
  computed: Record<string, StorageFieldDefinition>
  schemaRelationships: Record<string, unknown>
  idProperty: string
}

export interface ProjectionRequest {
  queryFieldNames?: readonly string[]
  queryFields?: Record<string, CompiledQueryField>
  schemaInfo?: Partial<StorageSchemaInfo>
  tableName?: string
  storageAdapter?: StorageAdapter | null
  db?: StorageDatabase | null
  context?: StorageContext | null
  scopeName?: string
}

export interface ProjectionRuntime {
  fieldName: string
  definition: CompiledQueryField
  schemaInfo: Partial<StorageSchemaInfo>
  expression: ProjectionExpression
  sql: string
  bindings: readonly unknown[]
}
