export type ResourceFormat = 'plain' | 'jsonapi'
export type WriteReturning = 'none' | 'minimal' | 'full'
export type InputResourceId = string | number
export type DirectResourceId = InputResourceId | bigint

export interface ResourceIdentifier<Type extends string = string> {
  type: Type
  id: string
}
export interface InputResourceIdentifier<Type extends string = string> {
  type: Type
  id: InputResourceId
}
export type JsonApiLink = string | { href: string; meta?: Record<string, unknown> } | null
export type JsonApiLinks = Record<string, JsonApiLink>
export interface JsonApiRelationship {
  data?: ResourceIdentifier | ResourceIdentifier[] | null
  links?: JsonApiLinks
  meta?: Record<string, unknown>
}
export interface JsonApiResource<Attributes extends object = Record<string, unknown>, Type extends string = string> extends ResourceIdentifier<Type> {
  attributes?: Partial<Attributes>
  relationships?: Record<string, JsonApiRelationship>
  links?: JsonApiLinks
  meta?: Record<string, unknown>
}
export interface JsonApiDocument<Data = JsonApiResource | JsonApiResource[] | null> {
  data: Data
  included?: JsonApiResource[]
  links?: JsonApiLinks
  meta?: Record<string, unknown>
  jsonapi?: { version?: string; meta?: Record<string, unknown> }
}

// Supply relationship properties in Fields too; sparse fieldsets can omit either.
export type PlainResource<Fields extends object = Record<string, unknown>> = { id: string } & Partial<Fields>
export interface PlainCollection<Fields extends object = Record<string, unknown>> {
  data: PlainResource<Fields>[]
  links?: JsonApiLinks
  meta?: Record<string, unknown>
}
export type SingleResourceResult<Format extends ResourceFormat, Fields extends object = Record<string, unknown>, Type extends string = string> =
  Format extends 'plain' ? PlainResource<Fields> : JsonApiDocument<JsonApiResource<Fields, Type>>
export type CollectionResult<Format extends ResourceFormat, Fields extends object = Record<string, unknown>, Type extends string = string> =
  Format extends 'plain' ? PlainCollection<Fields> : JsonApiDocument<JsonApiResource<Fields, Type>[]>
export type WriteResult<Format extends ResourceFormat, Returning extends WriteReturning, Fields extends object = Record<string, unknown>, Type extends string = string> =
  Returning extends 'none' ? void
    : Returning extends 'minimal'
      ? Format extends 'plain' ? ResourceIdentifier<Type> : JsonApiDocument<ResourceIdentifier<Type>>
      : SingleResourceResult<Format, Fields, Type>
