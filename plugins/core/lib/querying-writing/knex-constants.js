/**
 * @module knex-constants
 * @description Shared constants for the REST API Knex plugin
 *
 * This module contains all the magic strings and shared constants used
 * throughout the plugin to avoid repetition and improve maintainability.
 */

// Internal property names - using unique names to avoid collisions with user data
export const RELATIONSHIPS_KEY = '__$jsonrestapi_relationships$__'
export const RELATIONSHIP_METADATA_KEY = '__$jsonrestapi_metadata$__'
export const ROW_NUMBER_KEY = '__$jsonrestapi_rn$__'
export const COMPUTED_DEPENDENCIES_KEY = '__$jsonrestapi_computed_deps$__'

// Default query limits
export const DEFAULT_QUERY_LIMIT = 20
export const DEFAULT_MAX_QUERY_LIMIT = 100
export const DEFAULT_MAX_INCLUDE_LIMIT = 1000
export const DEFAULT_INCLUDE_DEPTH_LIMIT = 3

// Schema handling helpers
export const getSchemaStructure = (schema) => schema?.structure || schema || {}
export const getIdProperty = (schemaInfo) => schemaInfo?.idProperty || 'id'

// Default values
export const DEFAULT_PAGE_SIZE = 20
export const DEFAULT_MAX_PAGE_SIZE = 100
export const DEFAULT_PAGE_NUMBER = 1

// Database clients
export const DB_CLIENTS = {
  POSTGRES: 'pg',
  MYSQL: 'mysql',
  MYSQL2: 'mysql2',
  SQLITE: 'sqlite3',
  MSSQL: 'mssql'
}

// Error subtypes
export const ERROR_SUBTYPES = {
  NOT_FOUND: 'not_found',
  VALIDATION: 'validation',
  PERMISSION: 'permission',
  CONFLICT: 'conflict'
}
