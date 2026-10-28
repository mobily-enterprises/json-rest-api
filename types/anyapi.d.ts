import type { Knex } from 'knex'

export type AnyapiSlotPool = 'string' | 'number' | 'boolean' | 'date' | 'json' | 'belongsTo'
export type AnyapiSlotCounts = Partial<Record<AnyapiSlotPool, number>>
// Pools whose slots can carry a (tenant_id, resource, slot) index.
export type AnyapiIndexedSlotPool = 'string' | 'number' | 'boolean' | 'date'
export type AnyapiIndexedSlotCounts = Partial<Record<AnyapiIndexedSlotPool, number>>

export interface AnyapiSchemaOptions {
  slots?: AnyapiSlotCounts
  // Fields declared `indexed: true` take these slots.
  indexedSlots?: AnyapiIndexedSlotCounts
}

export interface AnyapiSchemaChange {
  tenant: string
  resource: string
  version: number
}

export interface AnyapiRegistryOptions {
  knex: Knex
  log?: Partial<Record<'debug' | 'info' | 'warn' | 'error', (...args: unknown[]) => unknown>>
  // Descriptors cached across every tenant API that shares the registry.
  cacheSize?: number
}

/** Canonical metadata shared by tenant APIs that use one Knex instance. */
export class AnyapiRegistry {
  constructor(options: AnyapiRegistryOptions)
  readonly knex: Knex
  readonly cacheSize: number
  ensureSchema(options?: AnyapiSchemaOptions): Promise<void>
  getSchemaVersion(tenant: string, resource: string, options?: { transaction?: Knex.Transaction }): Promise<number | null>
  // Retired fields keep their slots and values and reject new writes.
  retireFields(params: { tenant: string; resource: string; fields: string[] }, options?: { transaction?: Knex.Transaction }): Promise<Record<string, unknown>>
  invalidateDescriptor(tenant: string, resource: string): void
}

/** Create or upgrade the canonical tables; counts only ever add slot columns. */
export function ensureAnyApiSchema(knex: Knex, options?: AnyapiSchemaOptions): Promise<void>
