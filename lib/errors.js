/**
 * Structured Error Classes for JSON REST API
 * 
 * Provides standardized error handling with proper HTTP status codes,
 * error codes, and JSON:API compliant error formatting.
 */

/**
 * Base API Error class
 */
export class ApiError extends Error {
  constructor(message, status = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    this.timestamp = new Date().toISOString();
    this.context = {};
    
    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }
  
  /**
   * Add context to the error
   */
  withContext(context) {
    this.context = { ...this.context, ...context };
    return this;
  }
  
  /**
   * Convert to JSON:API error format
   */
  toJSON() {
    return {
      status: String(this.status),
      code: this.code,
      title: this.name,
      detail: this.message,
      meta: {
        timestamp: this.timestamp,
        ...this.context
      }
    };
  }
}

/**
 * 400 Bad Request - Invalid request format or parameters
 */
export class BadRequestError extends ApiError {
  constructor(message = 'Bad Request', code = 'BAD_REQUEST') {
    super(message, 400, code);
  }
}

/**
 * 401 Unauthorized - Authentication required
 */
export class UnauthorizedError extends ApiError {
  constructor(message = 'Unauthorized', code = 'UNAUTHORIZED') {
    super(message, 401, code);
  }
}

/**
 * 403 Forbidden - Valid auth but insufficient permissions
 */
export class ForbiddenError extends ApiError {
  constructor(message = 'Forbidden', code = 'FORBIDDEN') {
    super(message, 403, code);
  }
}

/**
 * 404 Not Found - Resource doesn't exist
 */
export class NotFoundError extends ApiError {
  constructor(resource = 'Resource', id = null) {
    const message = id 
      ? `${resource} with id '${id}' not found`
      : `${resource} not found`;
    super(message, 404, 'NOT_FOUND');
    this.resource = resource;
    this.resourceId = id;
  }
  
  toJSON() {
    const json = super.toJSON();
    if (this.resourceId) {
      json.source = { parameter: 'id' };
    }
    return json;
  }
}

/**
 * 409 Conflict - Request conflicts with current state
 */
export class ConflictError extends ApiError {
  constructor(message = 'Conflict', code = 'CONFLICT') {
    super(message, 409, code);
  }
}

/**
 * 422 Unprocessable Entity - Validation errors
 */
export class ValidationError extends ApiError {
  constructor(errors = []) {
    super('Validation failed', 422, 'VALIDATION_ERROR');
    this.validationErrors = errors;
  }
  
  /**
   * Add a field error
   */
  addFieldError(field, message, code = 'INVALID_VALUE') {
    this.validationErrors.push({ field, message, code });
    return this;
  }
  
  /**
   * Add multiple field errors
   */
  addFieldErrors(errors) {
    this.validationErrors.push(...errors);
    return this;
  }
  
  /**
   * Check if there are any errors
   */
  hasErrors() {
    return this.validationErrors.length > 0;
  }
  
  /**
   * Convert to JSON:API errors array
   */
  toJSON() {
    if (this.validationErrors.length === 0) {
      return [super.toJSON()];
    }
    
    return this.validationErrors.map(err => ({
      status: '422',
      code: err.code || 'VALIDATION_ERROR',
      title: 'Validation Error',
      detail: err.message,
      source: { pointer: `/data/attributes/${err.field}` },
      meta: {
        field: err.field,
        value: err.value,
        ...err.meta
      }
    }));
  }
}

/**
 * 429 Too Many Requests - Rate limit exceeded
 */
export class RateLimitError extends ApiError {
  constructor(retryAfter = null) {
    super('Too many requests', 429, 'RATE_LIMIT_EXCEEDED');
    this.retryAfter = retryAfter;
  }
  
  toJSON() {
    const json = super.toJSON();
    if (this.retryAfter) {
      json.meta.retryAfter = this.retryAfter;
    }
    return json;
  }
}

/**
 * 500 Internal Server Error
 */
export class InternalError extends ApiError {
  constructor(message = 'Internal server error', code = 'INTERNAL_ERROR') {
    super(message, 500, code);
  }
}

/**
 * 503 Service Unavailable
 */
export class ServiceUnavailableError extends ApiError {
  constructor(message = 'Service temporarily unavailable', retryAfter = null) {
    super(message, 503, 'SERVICE_UNAVAILABLE');
    this.retryAfter = retryAfter;
  }
  
  toJSON() {
    const json = super.toJSON();
    if (this.retryAfter) {
      json.meta.retryAfter = this.retryAfter;
    }
    return json;
  }
}

/**
 * Error code constants for standardization
 */
export const ErrorCodes = {
  // Client errors
  BAD_REQUEST: 'BAD_REQUEST',
  INVALID_FORMAT: 'INVALID_FORMAT',
  MISSING_PARAMETER: 'MISSING_PARAMETER',
  INVALID_PARAMETER: 'INVALID_PARAMETER',
  
  // Auth errors
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  
  // Resource errors
  NOT_FOUND: 'NOT_FOUND',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  ENDPOINT_NOT_FOUND: 'ENDPOINT_NOT_FOUND',
  
  // Conflict errors
  CONFLICT: 'CONFLICT',
  DUPLICATE_RESOURCE: 'DUPLICATE_RESOURCE',
  RESOURCE_LOCKED: 'RESOURCE_LOCKED',
  OPTIMISTIC_LOCK_ERROR: 'OPTIMISTIC_LOCK_ERROR',
  
  // Validation errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_VALUE: 'INVALID_VALUE',
  REQUIRED_FIELD: 'REQUIRED_FIELD',
  FIELD_TOO_LONG: 'FIELD_TOO_LONG',
  FIELD_TOO_SHORT: 'FIELD_TOO_SHORT',
  INVALID_TYPE: 'INVALID_TYPE',
  INVALID_FORMAT: 'INVALID_FORMAT',
  INVALID_ENUM_VALUE: 'INVALID_ENUM_VALUE',
  
  // Server errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  
  // Rate limiting
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED'
};

/**
 * Helper to create error from unknown thrown value
 */
export function normalizeError(error) {
  if (error instanceof ApiError) {
    return error;
  }
  
  if (error instanceof Error) {
    const apiError = new InternalError(error.message);
    apiError.stack = error.stack;
    return apiError.withContext({ originalError: error.name });
  }
  
  return new InternalError(String(error));
}

/**
 * Format errors for JSON:API response
 */
export function formatErrorResponse(error) {
  const apiError = normalizeError(error);
  
  return {
    errors: Array.isArray(apiError.toJSON()) 
      ? apiError.toJSON() 
      : [apiError.toJSON()]
  };
}