import { HookedApiError } from 'hooked-api'

/**
 * REST API specific error classes that can be mapped to HTTP status codes
 * by the HTTP plugin or other protocol plugins
 */

/**
 * Validation error for invalid payloads, schema violations, etc.
 * HTTP plugin should map this to 422 Unprocessable Entity
 */
export class RestApiValidationError extends HookedApiError {
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
export class RestApiResourceError extends HookedApiError {
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

/**
 * Payload structure errors (malformed JSON:API documents)
 * HTTP plugin should map this to 400 Bad Request
 */
export class RestApiPayloadError extends HookedApiError {
  constructor (message, { path, expected, received } = {}) {
    super(message, 'REST_API_PAYLOAD_ERROR')
    this.code = 'REST_API_PAYLOAD'
    this.type = 'rest_api_payload'
    this.path = path
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
      details: this.details,
      stack: this.stack
    }
  }
}
