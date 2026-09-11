import type { DirectResourceId, ResourceFormat, WriteReturning } from './representations.js'
import type { RemovedResourceOptions } from './resource-methods.js'
import type { Knex } from 'knex'

export type RestApiPluginOptions = RemovedResourceOptions & {
  format?: ResourceFormat
  returning?: WriteReturning
  queryDefaultLimit?: number
  queryMaxLimit?: number
  includeDepthLimit?: number
  enablePaginationCounts?: boolean
  idProperty?: string
  normalizeId?: (value: unknown) => DirectResourceId | null | undefined
}

export interface HttpConnectorOptions {
  mountPath?: string
  publicBaseUrl?: string
  strictContentType?: boolean
  handle404?: boolean
  httpValidators?: boolean
}

export interface ResourceVersionOptions {
  // Compilation validates that this names a stored, untransformed string attribute.
  versionField?: string
}

export type CorsOrigin = string | RegExp | ((origin: string) => boolean | Promise<boolean>) | CorsOrigin[]
export interface CorsPluginOptions {
  origin?: CorsOrigin
  credentials?: boolean
  methods?: string[]
  allowedHeaders?: string[]
  exposedHeaders?: string[]
  maxAge?: number
  optionsSuccessStatus?: number
}

export interface RestApiKnexPluginOptions {
  knex: Knex
}
export interface RestApiAnyapiKnexPluginOptions extends RestApiKnexPluginOptions {
  tenantId?: string
}
export interface BulkOperationsPluginOptions {
  maxBulkOperations?: number
  defaultAtomic?: boolean
}
export interface LabelPluginOptions {
  preferNameFields?: string[]
  disable?: boolean
}
