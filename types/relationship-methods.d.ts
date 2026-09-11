import type {
  CollectionResult, DirectResourceId, InputResourceIdentifier, JsonApiDocument,
  JsonApiResource, PlainResource, ResourceFormat, ResourceIdentifier
} from './representations.js'
import type { QueryParams, RemovedResourceOptions, SelectionParams, TransactionParam } from './resource-methods.js'
import type { ManagedTransactionParam } from './transactions.js'

// Type-only descriptions of the resource's configured relationships.
export interface ToOneRelationship<Fields extends object = Record<string, unknown>, Type extends string = string> {
  cardinality: 'one'
  fields: Fields
  type: Type
}
export interface ToManyRelationship<Fields extends object = Record<string, unknown>, Type extends string = string> {
  cardinality: 'many'
  fields: Fields
  type: Type
}
type RelationshipShape = ToOneRelationship<object> | ToManyRelationship<object>
type RelationshipKeys<Relations> = Extract<keyof Relations, string>
type ToManyKeys<Relations> = {
  [Key in keyof Relations]: Extract<Relations[Key], { cardinality: 'many' }> extends never ? never : Key
}[keyof Relations] & string
export type RelationshipLinkage<Relation extends RelationshipShape> = Relation extends ToManyRelationship<object>
  ? ResourceIdentifier<Relation['type']>[] : ResourceIdentifier<Relation['type']> | null
export type RelationshipInput<Relation extends RelationshipShape> = Relation extends ToManyRelationship<object>
  ? InputResourceIdentifier<Relation['type']>[] : InputResourceIdentifier<Relation['type']> | null
export type RelatedResourceResult<Relation extends RelationshipShape, Format extends ResourceFormat> =
  Relation extends ToManyRelationship<object>
    ? CollectionResult<Format, Relation['fields'], Relation['type']>
    : Format extends 'plain' ? PlainResource<Relation['fields']> | null
      : JsonApiDocument<JsonApiResource<Relation['fields'], Relation['type']> | null>
type RelationshipOptions<Name extends string> = RemovedResourceOptions & TransactionParam & {
  id: DirectResourceId
  relationshipName: Name
}
type RelatedQueryParams<Relation extends RelationshipShape> = Relation extends ToManyRelationship<object> ? QueryParams : SelectionParams
type RelationshipWriteOptions<Name extends string> = Omit<RelationshipOptions<Name>, 'transaction'> & ManagedTransactionParam

export interface RelationshipMethods<
  Relations extends { [Key in keyof Relations]: RelationshipShape } = Record<string, ToOneRelationship | ToManyRelationship>,
  DefaultFormat extends ResourceFormat = 'plain', Context extends object = object
> {
  getRelationship<Name extends RelationshipKeys<Relations>>(
    params: RelationshipOptions<Name> & { format?: ResourceFormat }, context?: Context
  ): Promise<JsonApiDocument<RelationshipLinkage<Relations[Name]>>>
  getRelated<Name extends RelationshipKeys<Relations>, Format extends ResourceFormat = DefaultFormat>(
    params: RelationshipOptions<Name> & {
      format?: Format
      queryParams?: NoInfer<RelatedQueryParams<Relations[Name]>>
    }, context?: Context
  ): Promise<RelatedResourceResult<Relations[Name], Format>>
  patchRelationship<Name extends RelationshipKeys<Relations>>(
    params: RelationshipWriteOptions<Name> & {
      format?: ResourceFormat
      relationshipData: NoInfer<RelationshipInput<Relations[Name]>>
      expectedVersion?: string
    }, context?: Context
  ): Promise<void>
  postRelationship<Name extends ToManyKeys<Relations>>(
    params: RelationshipWriteOptions<Name> & {
      format?: ResourceFormat
      relationshipData: InputResourceIdentifier<NoInfer<Relations[Name]['type']>>[]
      expectedVersion?: string
    }, context?: Context
  ): Promise<void>
  deleteRelationship<Name extends ToManyKeys<Relations>>(
    params: RelationshipWriteOptions<Name> & {
      format?: ResourceFormat
      relationshipData: InputResourceIdentifier<NoInfer<Relations[Name]['type']>>[]
      expectedVersion?: string
    }, context?: Context
  ): Promise<void>
}
