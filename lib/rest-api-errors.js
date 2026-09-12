import { types } from 'node:util'

export class RestApiError extends Error {
  /** @param {string} message @param {unknown} [code] */
  constructor (message, code = 'REST_API_ERROR') {
    super(message)
    this.name = this.constructor.name
    this.code = code
    Error.captureStackTrace(this, this.constructor)
  }
}

export const REST_API_FIELDSET_ERROR_CODE = 'REST_API_FIELDSET_INVALID'
export const REST_API_INCLUDE_ERROR_CODE = 'REST_API_INCLUDE_INVALID'
export const REST_API_TEMPORAL_DATA_ERROR_CODE = 'REST_API_TEMPORAL_DATA_INVALID'

const transactionOutcomes = new Set(['none', 'pending', 'committed', 'rolledBack', 'unknown'])
const writeErrorFields = ['code', 'type', 'subtype', 'details', 'statusCode', 'status', 'path', 'parameter', 'validation']

export class RestApiWriteError extends RestApiError {
  constructor (message, { cause, transactionOutcome } = {}) {
    super(message, 'REST_API_WRITE')
    if (!transactionOutcomes.has(transactionOutcome)) throw new TypeError('Invalid transaction outcome')
    Object.defineProperty(this, 'cause', { value: cause, configurable: true, writable: true })
    Object.defineProperty(this, 'transactionOutcome', { value: transactionOutcome, enumerable: true })
    if (cause && (typeof cause === 'object' || typeof cause === 'function')) {
      for (const field of writeErrorFields) {
        let descriptor
        let owner = cause
        try {
          while (owner) {
            descriptor = Object.getOwnPropertyDescriptor(owner, field)
            // Proxy prototype links may cycle or invent an unlimited chain.
            if (descriptor || types.isProxy(owner)) break
            owner = Object.getPrototypeOf(owner)
          }
        } catch { /* Unreadable metadata must not replace the original cause or outcome. */ }
        if (descriptor && Object.hasOwn(descriptor, 'value')) this[field] = descriptor.value
      }
    }
  }

  toJSON () {
    return {
      name: this.name,
      message: this.message,
      ...Object.fromEntries(writeErrorFields.filter(field => Object.hasOwn(this, field)).map(field => [field, this[field]])),
      transactionOutcome: this.transactionOutcome
    }
  }
}

/**
 * REST API specific error classes that can be mapped to HTTP status codes
 * by the HTTP plugin or other protocol plugins
 */

/**
 * Validation error for invalid payloads, schema violations, etc.
 * HTTP plugin should map this to 422 Unprocessable Entity
 */
export class RestApiValidationError extends RestApiError {
  /**
   * @param {string} message
   * @param {{ fields?: string[], violations?: Array<{ field: string, rule?: string, message: string }> }} [options]
   */
  constructor (message, { fields = [], violations = [] } = {}) {
    super(message, 'REST_API_VALIDATION_ERROR')
    this.code = 'REST_API_VALIDATION'
    this.type = 'rest_api_validation'
    this.details = {
      fields,
      violations
    }
  }

  toJSON () {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      type: this.type,
      details: this.details,
      stack: this.stack
    }
  }
}

/**
 * Resource-related errors (not found, conflicts, forbidden access)
 * HTTP plugin should map based on subtype
 */
export class RestApiResourceError extends RestApiError {
  constructor (message, { subtype, resourceType, resourceId } = {}) {
    super(message, 'REST_API_RESOURCE_ERROR')
    this.code = 'REST_API_RESOURCE'
    this.type = 'rest_api_resource'
    this.subtype = subtype // 'not_found', 'conflict', 'forbidden'
    this.details = {
      resourceType,
      resourceId
    }
  }

  toJSON () {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      type: this.type,
      subtype: this.subtype,
      details: this.details,
      stack: this.stack
    }
  }
}

export class RestApiVersionConflictError extends RestApiResourceError {
  constructor ({ resourceType, resourceId } = {}) {
    super('Resource version condition failed', { subtype: 'conflict', resourceType, resourceId })
    this.code = 'REST_API_VERSION_CONFLICT'
    this.type = 'rest_api_version_conflict'
  }
}

export class RestApiPreconditionFailedError extends RestApiResourceError {
  constructor ({ resourceType, resourceId } = {}) {
    super('HTTP representation precondition failed', { subtype: 'precondition_failed', resourceType, resourceId })
    this.code = 'REST_API_PRECONDITION_FAILED'
    this.type = 'rest_api_precondition_failed'
  }
}

/**
 * Payload structure errors (malformed JSON:API documents)
 * HTTP plugin should map this to 400 Bad Request
 */
export class RestApiPayloadError extends RestApiError {
  constructor (message, { path, parameter, expected, received, statusCode = 400, cause } = {}) {
    super(message, 'REST_API_PAYLOAD_ERROR')
    this.code = 'REST_API_PAYLOAD'
    this.type = 'rest_api_payload'
    this.statusCode = statusCode
    if (cause !== undefined) this.cause = cause
    this.path = path
    this.parameter = parameter
    this.details = {
      path,
      expected,
      received
    }
  }

  toJSON () {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      type: this.type,
      path: this.path,
      parameter: this.parameter,
      statusCode: this.statusCode,
      details: this.details,
      stack: this.stack
    }
  }
}

/**
 * Invalid JSON:API sparse fieldset.
 *
 * The structured code lets transports distinguish invalid client input from
 * query or include failures without parsing the human-readable message.
 */
export class RestApiFieldsetError extends RestApiError {
  constructor ({ field, resourceType } = {}) {
    super(
      field === undefined
        ? `Unknown resource type '${resourceType}' requested in sparse fields`
        : `Unknown sparse field '${field}' requested for '${resourceType}'`,
      REST_API_FIELDSET_ERROR_CODE
    )
    this.type = 'rest_api_fieldset'
    this.statusCode = 400
    this.details = {
      field,
      resourceType
    }
  }

  toJSON () {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      type: this.type,
      statusCode: this.statusCode,
      details: this.details,
      stack: this.stack
    }
  }
}

export class RestApiIncludeError extends RestApiError {
  constructor ({ path, resourceType } = {}) {
    super(`Unsupported include path '${path}' requested for '${resourceType}'`, REST_API_INCLUDE_ERROR_CODE)
    this.type = 'rest_api_include'
    this.statusCode = 400
    this.details = { path, resourceType }
  }

  toJSON () {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      type: this.type,
      statusCode: this.statusCode,
      details: this.details,
      stack: this.stack
    }
  }
}

/**
 * A non-null temporal value produced by storage or response enrichment does
 * not satisfy the resource's public temporal contract.
 */
export class RestApiTemporalDataError extends RestApiError {
  constructor ({ field, resourceType, fieldType, source = 'database' } = {}) {
    const fieldPath = [resourceType, field].filter(Boolean).join('.') || 'unknown field'
    super(
      `Invalid ${source} value for ${fieldType || 'temporal'} field '${fieldPath}'.`,
      REST_API_TEMPORAL_DATA_ERROR_CODE
    )
    this.type = 'rest_api_temporal_data'
    this.statusCode = 500
    this.details = {
      field,
      resourceType,
      fieldType,
      source
    }
  }

  toJSON () {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      type: this.type,
      statusCode: this.statusCode,
      details: this.details,
      stack: this.stack
    }
  }
}
