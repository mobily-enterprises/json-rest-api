import type { ResourceConversionSchema, StorageAdapter, StorageContext, StorageDatabase, StorageFieldDefinition, StorageQuery } from '../storage/storage-types.js'
import type { CompiledQueryField, ProjectionRuntime } from './query-field-types.js'
import type { Fieldsets } from './field-utils.js'

export interface SelectionSchema extends Partial<ResourceConversionSchema> {
  queryFields?: Record<string, CompiledQueryField>
  outputRelationships?: Record<string, StorageFieldDefinition>
  readDependencies?: Record<string, readonly string[]>
}

export interface SelectionScope {
  vars?: { schemaInfo?: SelectionSchema }
}

export interface SelectionContext extends StorageContext {
  scopeName: string
  queryParams?: { fields?: Fieldsets; sort?: unknown }
}

export interface FieldSelection {
  fieldsToSelect: string[]
  queryFieldsToSelect: string[]
  requestedFields: readonly string[] | null
  computedDependencies: string[]
  idProperty: 'id'
}

export interface SelectionQueryRequest {
  query: StorageQuery
  scope?: SelectionScope | null
  fieldSelectionInfo?: Partial<FieldSelection> | null
  tableName: string
  useTablePrefix?: boolean
  storageAdapter?: StorageAdapter | null
  db?: StorageDatabase | null
  context?: StorageContext | null
  scopeName?: string
}

export interface SelectedQuery {
  query: StorageQuery
  queryFieldRuntimeByField: Map<string, ProjectionRuntime>
}
