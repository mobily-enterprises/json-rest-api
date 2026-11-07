export class RestApiError extends Error {
  constructor(message: string, code?: unknown)
  code: unknown
}

export type TransactionOutcome = 'none' | 'pending' | 'committed' | 'rolledBack' | 'unknown'
export interface ResourceErrorOptions {
  resourceType?: string
  resourceId?: string | number
}
export interface ValidationViolation {
  field: string
  rule?: string
  message: string
}
export interface SerializedError {
  name: string
  message: string
  stack?: string
  [key: string]: unknown
}

export const REST_API_FIELDSET_ERROR_CODE: 'REST_API_FIELDSET_INVALID'
export const REST_API_INCLUDE_ERROR_CODE: 'REST_API_INCLUDE_INVALID'
export const REST_API_TEMPORAL_DATA_ERROR_CODE: 'REST_API_TEMPORAL_DATA_INVALID'

export class RestApiWriteError extends RestApiError {
  constructor(message: string, options: { cause?: unknown; transactionOutcome: TransactionOutcome })
  cause?: unknown
  readonly transactionOutcome: TransactionOutcome
  code: unknown
  type?: unknown
  subtype?: unknown
  details?: unknown
  statusCode?: unknown
  status?: unknown
  path?: unknown
  parameter?: unknown
  validation?: unknown
  toJSON(): SerializedError & { transactionOutcome: TransactionOutcome }
}

export class RestApiValidationError extends RestApiError {
  constructor(message: string, options?: { fields?: string[]; violations?: ValidationViolation[] })
  code: 'REST_API_VALIDATION'
  type: 'rest_api_validation'
  details: { fields: string[]; violations: ValidationViolation[] }
  toJSON(): SerializedError & Pick<RestApiValidationError, 'code' | 'type' | 'details'>
}

export class RestApiResourceError extends RestApiError {
  constructor(message: string, options?: ResourceErrorOptions & { subtype?: string })
  code: string
  type: string
  subtype: string | undefined
  details: ResourceErrorOptions
  toJSON(): SerializedError & Pick<RestApiResourceError, 'code' | 'type' | 'subtype' | 'details'>
}

export class RestApiVersionConflictError extends RestApiResourceError {
  constructor(options?: ResourceErrorOptions)
  code: 'REST_API_VERSION_CONFLICT'
  type: 'rest_api_version_conflict'
  subtype: 'conflict'
}

export class RestApiPreconditionFailedError extends RestApiResourceError {
  constructor(options?: ResourceErrorOptions)
  code: 'REST_API_PRECONDITION_FAILED'
  type: 'rest_api_precondition_failed'
  subtype: 'precondition_failed'
}

export class RestApiPayloadError extends RestApiError {
  constructor(message: string, options?: {
    path?: string
    parameter?: string
    expected?: unknown
    received?: unknown
    statusCode?: number
    cause?: unknown
  })
  code: 'REST_API_PAYLOAD'
  type: 'rest_api_payload'
  statusCode: number
  cause?: unknown
  path: string | undefined
  parameter: string | undefined
  details: { path: string | undefined; expected: unknown; received: unknown }
  toJSON(): SerializedError & Pick<RestApiPayloadError, 'code' | 'type' | 'statusCode' | 'path' | 'parameter' | 'details'>
}

export class RestApiFieldsetError extends RestApiError {
  constructor(options?: { field?: string; resourceType?: string })
  code: typeof REST_API_FIELDSET_ERROR_CODE
  type: 'rest_api_fieldset'
  statusCode: number
  details: { field?: string; resourceType?: string }
  toJSON(): SerializedError & Pick<RestApiFieldsetError, 'code' | 'type' | 'statusCode' | 'details'>
}

export class RestApiIncludeError extends RestApiError {
  constructor(options?: { path?: string; resourceType?: string })
  code: typeof REST_API_INCLUDE_ERROR_CODE
  type: 'rest_api_include'
  statusCode: number
  details: { path?: string; resourceType?: string }
  toJSON(): SerializedError & Pick<RestApiIncludeError, 'code' | 'type' | 'statusCode' | 'details'>
}

export class RestApiTemporalDataError extends RestApiError {
  constructor(options?: { field?: string; resourceType?: string; fieldType?: string; source?: string })
  code: typeof REST_API_TEMPORAL_DATA_ERROR_CODE
  type: 'rest_api_temporal_data'
  statusCode: number
  details: { field?: string; resourceType?: string; fieldType?: string; source: string }
  toJSON(): SerializedError & Pick<RestApiTemporalDataError, 'code' | 'type' | 'statusCode' | 'details'>
}

export class RestApiBulkWriteUnsupportedError extends RestApiError {
  constructor(options?: { resourceType?: string; operation?: string; reason?: string; hooks?: string[] })
  code: 'REST_API_BULK_WRITE_UNSUPPORTED'
  type: 'rest_api_bulk_write_unsupported'
  statusCode: 422
  /** `hooks` names the per-record hooks that caused the refusal; HTTP responses leave details out. */
  details: { resourceType?: string; operation?: string; reason?: string; hooks?: string[] }
  toJSON(): SerializedError & Pick<RestApiBulkWriteUnsupportedError, 'code' | 'type' | 'statusCode' | 'details'>
}

// Reports only how many requested records are missing or outside the caller's scope.
export class RestApiRecordsNotFoundError extends RestApiResourceError {
  constructor(options?: { resourceType?: string; missing?: number })
  subtype: 'not_found'
  details: { resourceType?: string; missing?: number }
}

export class RestApiBulkInsertIdsError extends RestApiError {
  constructor(options?: { resourceType?: string; expected?: number; verified?: number })
  code: 'REST_API_BULK_INSERT_IDS'
  type: 'rest_api_bulk_insert_ids'
  details: { resourceType?: string; expected?: number; verified?: number }
  toJSON(): SerializedError & Pick<RestApiBulkInsertIdsError, 'code' | 'type' | 'details'>
}

export class RestApiLockOutsideTransactionError extends RestApiValidationError {
  constructor(options?: { resourceType?: string; operation?: string })
}

export class RestApiScopedQueryReadOnlyError extends RestApiError {
  constructor(options?: { resourceType?: string; method?: string })
  code: 'REST_API_SCOPED_QUERY_READ_ONLY'
  type: 'rest_api_scoped_query_read_only'
  details: { resourceType?: string; method?: string }
  toJSON(): SerializedError & Pick<RestApiScopedQueryReadOnlyError, 'code' | 'type' | 'details'>
}

export class RestApiRowLimitError extends RestApiError {
  constructor(options?: { resourceType?: string; rowLimit?: number })
  code: 'REST_API_ROW_LIMIT'
  type: 'rest_api_row_limit'
  details: { resourceType?: string; rowLimit?: number }
  toJSON(): SerializedError & Pick<RestApiRowLimitError, 'code' | 'type' | 'details'>
}
