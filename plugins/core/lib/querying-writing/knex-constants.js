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
export const RELATIONSHIP_WRITE_BATCH_SIZE = 100
export const RELATIONSHIP_READ_BATCH_SIZE = 100

// Error subtypes
export const ERROR_SUBTYPES = {
  NOT_FOUND: 'not_found',
  VALIDATION: 'validation',
  PERMISSION: 'permission',
  CONFLICT: 'conflict'
}
