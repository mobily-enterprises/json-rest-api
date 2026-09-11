import type { DiagnosticLogger, DiagnosticWriter } from '../lib/logger-types.js'
import type { TransactionMethods } from './transactions.js'

export type RuntimeLogger = Record<'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal', DiagnosticWriter>
export interface RuntimeResource {
  name: string
  scopeOptions: Readonly<Record<string, unknown>>
  vars: Record<string, unknown>
  helpers: Record<string, unknown>
  [method: string]: unknown
}
export interface RuntimeArguments {
  api: JsonRestApi
  name: string | undefined
  apiOptions: Readonly<Record<string, unknown>>
  params: Record<string, unknown>
  context: Record<string, unknown>
  scope: RuntimeResource | undefined
  scopeName: string | undefined
  scopeOptions: Readonly<Record<string, unknown>> | undefined
  scopes: Record<string, RuntimeResource>
  vars: Record<string, unknown>
  helpers: Record<string, unknown>
  log: RuntimeLogger
  runHooks(event: string, context?: Record<string, unknown>): Promise<boolean>
}
export type RuntimeMethod = (args: RuntimeArguments) => unknown
export type HookPlacement = { beforeFunction?: string; afterFunction?: never } | { beforeFunction?: never; afterFunction?: string }
export type RuntimeHook = RuntimeMethod | (HookPlacement & { functionName?: string; handler: RuntimeMethod })
export interface RuntimeCustomization {
  hooks?: Record<string, RuntimeHook>
  methods?: Record<string, RuntimeMethod>
  vars?: Record<string, unknown>
  helpers?: Record<string, unknown>
}
export interface RuntimeResourceOptions extends RuntimeCustomization {
  scopeMethods?: never
  [option: string]: unknown
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

// Supply your resource method interfaces explicitly; schemas are not inferred.
export class JsonRestApi<Resources extends object = Record<string, RuntimeResource>> {
  constructor(options?: { name?: string; logger?: DiagnosticLogger })
  name: string | undefined
  log: RuntimeLogger
  options: Readonly<Record<string, unknown>>
  vars: Record<string, unknown>
  helpers: Record<string, unknown>
  resources: Resources
  use(plugin: LibraryPlugin, options?: object): Promise<this>
  addResource<Name extends keyof Resources & string>(name: Name, options?: RuntimeResourceOptions): Promise<Resources[Name]>
  customize(options?: RuntimeCustomization): Promise<this>
  runHooks(event: string, context?: Record<string, unknown>): Promise<boolean>
  // Available after installing RestApiPlugin.
  transaction: TransactionMethods['transaction']
  release(): Promise<void>
}
