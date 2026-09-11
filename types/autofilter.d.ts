import type { StorageFieldDefinition } from '../plugins/core/lib/storage/storage-types.js'

export interface AutoFilterResolverParams<Context extends object = Record<string, unknown>, Api extends object = object> {
  context: Context
  scopeName: string
  filter: CompiledAutoFilter<Context, Api>
  api: Api
  helpers: Record<string, unknown>
  scopes: Record<string, unknown>
  vars: Record<string, unknown>
  log: unknown
}

// The field serializer owns the value domain; undefined is meaningful for optional filters.
export type AutoFilterResolver<Context extends object = Record<string, unknown>, Api extends object = object> = (
  params: AutoFilterResolverParams<Context, Api>
) => unknown

export interface CompiledAutoFilter<Context extends object = Record<string, unknown>, Api extends object = object> {
  field: string
  fieldDef: StorageFieldDefinition
  resolve: AutoFilterResolver<Context, Api>
  resolverName: string
  required: boolean
  relationshipName: string | null
  relationshipType: string | null
  inputPath: string
}

export type AutoFilterDefinition<Context extends object = Record<string, unknown>, Api extends object = object> = {
  field: string
  required?: boolean
} & (
  { resolve: string | AutoFilterResolver<Context, Api>; resolver?: string | AutoFilterResolver<Context, Api> }
  | { resolve?: undefined | null; resolver: string | AutoFilterResolver<Context, Api> }
)

export type AutoFilterPreset<Context extends object = Record<string, unknown>, Api extends object = object> =
  AutoFilterDefinition<Context, Api>[] | { filters: AutoFilterDefinition<Context, Api>[] }

export interface AutoFilterPluginOptions<Context extends object = Record<string, unknown>, Api extends object = object> {
  resolvers?: Record<string, AutoFilterResolver<Context, Api>>
  presets?: Record<string, AutoFilterPreset<Context, Api>>
}

export type ResourceAutoFilter<Context extends object = Record<string, unknown>, Api extends object = object> =
  string | false | null | AutoFilterDefinition<Context, Api>[]
  | { preset: string; filters?: AutoFilterDefinition<Context, Api>[] }
  | { preset?: string; filters: AutoFilterDefinition<Context, Api>[] }

export interface AutoFilterRegistry {
  getConfig(): { presets: string[]; resolvers: string[] }
  getScopeConfig(scopeName: string): {
    preset: string | null
    filters: Array<{ field: string; resolver: string; required: boolean }>
  } | null
}
