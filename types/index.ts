// Main type exports for json-rest-api
export * from './schema.types.js';
export * from './api.types.js';
export * from './plugin.types.js';
export * from './inference.js';

// Re-export commonly used types at top level
export type {
  SchemaDefinition,
  SchemaFieldDefinition,
  SchemaType,
  ValidationContext,
} from './schema.types.js';

export type {
  HookContext,
  HookFunction,
  QueryOptions,
  QueryResult,
} from './api.types.js';

export type {
  Plugin,
  StorageAdapter,
} from './plugin.types.js';

// Type for the main Api class (will be properly typed when api.js is converted)
export interface Api {
  options: ApiOptions;
  resources: Record<string, ResourceProxy>;
  
  use<T = any>(plugin: Plugin<T>, options?: T): void;
  addResource(name: string, schema: any, options?: ResourceOptions): ResourceProxy;
  removeResource(name: string): void;
  
  hook(name: string, handler: HookFunction, priority?: number): void;
  unhook(name: string, handler: HookFunction): void;
  
  implement(method: string, handler: Function): void;
  
  transaction<T>(callback: () => Promise<T>): Promise<T>;
  
  // Extended with plugins
  queue?: Queue;
  scheduler?: Scheduler;
  [key: string]: any;
}

import type { ApiOptions, ResourceOptions, ResourceProxy } from './api.types.js';
import type { Queue } from './plugin.types.js';
import type { Scheduler } from './plugin.types.js';