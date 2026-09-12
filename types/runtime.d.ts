import type { DiagnosticLogger, DiagnosticWriter } from '../lib/logger-types.js'
import type { TransactionMethods } from './transactions.js'
import type { ResourceFormat, WriteReturning } from './representations.js'
import type { ResourceCoreMethods } from './resource-methods.js'
import type { ResourceField, ResourceSchema, ResourceSearchSchema, ResourceRelationship, InferInput, InferOutput } from './resource-schema.js'
import type { KnownHookName, HookHandler } from './hook-context.js'
import type { RestApiPluginOptions } from './plugin-options.js'
import type { ResourceAutoFilter } from './autofilter.js'
import type { ResourceRowPolicy } from './row-policy.js'
import type { CanonicalDescriptor, StorageConfig } from '../plugins/core/lib/storage/storage-types.js'

export type RuntimeLogger = Record<'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal', DiagnosticWriter>
export interface RuntimeResource {
  name: string
  scopeOptions: Readonly<Record<string, unknown>>
  vars: Record<string, unknown>
  helpers: Record<string, unknown>
  [method: string]: unknown
}
export interface RuntimeArguments<Context extends object = Record<string, unknown>> {
  api: JsonRestApi
  name: string | undefined
  apiOptions: Readonly<Record<string, unknown>>
  params: Record<string, unknown>
  context: Context
  scope: RuntimeResource | undefined
  scopeName: string | undefined
  scopeOptions: Readonly<Record<string, unknown>> | undefined
  scopes: Record<string, RuntimeResource>
  vars: Record<string, unknown>
  helpers: Record<string, unknown>
  log: RuntimeLogger
  runHooks(event: string, context?: Record<string, unknown>): Promise<boolean>
}
export type RuntimeMethod<Context extends object = Record<string, unknown>> = (args: RuntimeArguments<Context>) => unknown
export type HookPlacement = { beforeFunction?: string; afterFunction?: never } | { beforeFunction?: never; afterFunction?: string }
type HookDefinition<Handler> = Handler | (HookPlacement & { functionName?: string; handler: Handler })
export type RuntimeHook<Context extends object = Record<string, unknown>> = HookDefinition<RuntimeMethod<Context>>
export type RuntimeHooks<Context extends object = Record<string, unknown>> = {
  [Event in KnownHookName]?: HookDefinition<HookHandler<Event, Context>>
} & {
  // Custom plugins own their context shape; annotate them with RuntimeHook<Context>.
  [event: string]: RuntimeHook<any> | undefined
}
export interface RuntimeCustomization<Context extends object = Record<string, unknown>> {
  hooks?: RuntimeHooks<Context>
  methods?: Record<string, RuntimeMethod>
  vars?: Record<string, unknown>
  helpers?: Record<string, unknown>
}
export interface RuntimeResourceOptions<Context extends object = Record<string, unknown>> extends RuntimeCustomization<Context>, RestApiPluginOptions {
  schema?: ResourceSchema
  searchSchema?: ResourceSearchSchema
  relationships?: Record<string, ResourceRelationship>
  tableName?: string
  storage?: StorageConfig
  canonicalFieldsMap?: CanonicalDescriptor['canonicalFieldMap']
  sortableFields?: string[]
  defaultSort?: string[]
  versionField?: string
  rowPolicy?: ResourceRowPolicy<Context>
  autofilter?: ResourceAutoFilter<Context>
  indexes?: Array<{ name?: string; columns: string[]; unique?: boolean }>
  foreignKeys?: Array<{
    name?: string
    columns: string[]
    referencedTableName: string
    referencedColumns: string[]
    deleteRule?: string
    updateRule?: string
  }>
  checkConstraints?: Array<{ name?: string; clause: string }>
  scopeMethods?: never
}
export interface PluginInstallation extends RuntimeArguments {
  pluginOptions: Record<string, unknown>
  addApiMethod(name: string, handler: RuntimeMethod): void
  addResourceMethod(name: string, handler: RuntimeMethod): void
  addHook(event: string, name: string, placement: HookPlacement, handler: RuntimeMethod): void
}
export interface LibraryPlugin<Name extends string = string> {
  name: Name
  dependencies?: (string | string[])[]
  install(context: PluginInstallation): unknown
}

export type InferredResource<
  Schema extends ResourceSchema,
  Name extends string,
  Format extends ResourceFormat = 'plain',
  Returning extends WriteReturning = 'full',
  Context extends object = Record<string, unknown>,
  IdProperty extends string = 'id'
> = string extends IdProperty ? RuntimeResource
  : RuntimeResource & ResourceCoreMethods<Omit<InferOutput<Schema>, IdProperty>, Omit<InferInput<Schema>, IdProperty>, Name, Format, Returning, Context>

// Check literal field option names without attempting to infer arbitrary plugin extensions.
type CheckedResourceSchema<Schema extends ResourceSchema> = {
  [Key in keyof Schema]: Schema[Key] & Record<Exclude<keyof Schema[Key], keyof ResourceField>, never>
}

// Inference describes built-in CRUD with declared schemas and standard API defaults.
// Supply an explicit resource map for dynamic enrichment, method overrides or other defaults.
export class JsonRestApi<Resources extends object = Record<string, RuntimeResource>, Context extends object = Record<string, unknown>> {
  constructor(options?: { name?: string; logger?: DiagnosticLogger })
  name: string | undefined
  log: RuntimeLogger
  options: Readonly<Record<string, unknown>>
  vars: Record<string, unknown>
  helpers: Record<string, unknown>
  resources: Resources
  use(plugin: LibraryPlugin, options?: object): Promise<this>
  addResource<
    const Name extends keyof Resources & string,
    const Schema extends ResourceSchema,
    const Format extends ResourceFormat = 'plain',
    const Returning extends WriteReturning = 'full',
    const IdProperty extends string = 'id'
  >(name: Name, options: RuntimeResourceOptions<Context> & {
    schema: Schema & CheckedResourceSchema<Schema>
    format?: Format
    returning?: Returning
    idProperty?: IdProperty
    methods?: never
  }): Promise<string extends keyof Resources ? InferredResource<Schema, Name, Format, Returning, Context, IdProperty> : Resources[Name]>
  addResource<Name extends keyof Resources & string>(name: Name, options?: RuntimeResourceOptions<Context>): Promise<Resources[Name]>
  customize(options?: RuntimeCustomization<Context>): Promise<this>
  runHooks(event: string, context?: Record<string, unknown>): Promise<boolean>
  // Available after installing RestApiPlugin.
  transaction: TransactionMethods['transaction']
  release(): Promise<void>
}
