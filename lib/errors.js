/**
 * Structured Error Classes for JSON REST API
 * 
 * Provides standardized error handling with proper HTTP status codes,
 * error codes, and JSON:API compliant error formatting.
 */

/**
 * Check if running in production environment
 * Using a function to allow runtime checking
 */
const isProduction = () => process.env.NODE_ENV === 'production';

/**
 * Error message mappings for production
 */
const SAFE_ERROR_MESSAGES = {
  // Database errors
  'ECONNREFUSED': 'Service temporarily unavailable',
  'ETIMEDOUT': 'Request timeout',
  'ER_DUP_ENTRY': 'Resource already exists',
  'ER_NO_REFERENCED_ROW': 'Invalid reference',
  'ER_ROW_IS_REFERENCED': 'Resource is referenced by other data',
  
  // Common programming errors
  'Cannot read property': 'Invalid request data',
  'Cannot read properties': 'Invalid request data',
  'is not a function': 'Internal processing error',
  'undefined is not': 'Invalid request format',
  'null is not': 'Invalid request format',
  
  // Type errors
  'Invalid Date': 'Invalid date format',
  'is not iterable': 'Invalid data format',
  'Converting circular structure': 'Invalid data structure',
  
  // Default
  '_default': 'An error occurred processing your request'
};

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
  toJSON(options = {}) {
    const { sanitize = isProduction() } = options;
    
    const error = {
      status: String(this.status),
      code: this.code,
      title: this.name,
      detail: sanitize ? this._getSafeMessage() : this.message,
      meta: {
        timestamp: this.timestamp
      }
    };
    
    // Add source field if available
    if (this.context.field || this.context.parameter || this.context.pointer) {
      error.source = {};
      
      // JSON Pointer to the field in the request body
      if (this.context.pointer) {
        error.source.pointer = this.context.pointer;
      } else if (this.context.field) {
        // Auto-generate pointer for field if not provided
        error.source.pointer = `/data/attributes/${this.context.field}`;
      }
      
      // Query parameter that caused the error
      if (this.context.parameter) {
        error.source.parameter = this.context.parameter;
      }
    }
    
    // In development, include context and additional details
    if (!sanitize) {
      error.meta = {
        ...error.meta,
        ...this.context
      };
      
      // Include stack trace in development for 500 errors
      if (this.status >= 500 && this.stack) {
        error.meta.stack = this.stack.split('\n').slice(0, 10); // Limit stack lines
      }
    } else {
      // In production, only include safe context fields
      const safeContextFields = ['resourceType', 'field', 'value', 'limit', 'retryAfter'];
      for (const field of safeContextFields) {
        if (this.context[field] !== undefined) {
          error.meta[field] = this.context[field];
        }
      }
    }
    
    return error;
  }
  
  /**
   * Get safe error message for production
   */
  _getSafeMessage() {
    // Client errors (4xx) usually have safe messages
    if (this.status >= 400 && this.status < 500) {
      return this.message;
    }
    
    // For server errors, map to safe messages
    const message = this.message;
    
    // Check for specific error patterns
    for (const [pattern, safeMessage] of Object.entries(SAFE_ERROR_MESSAGES)) {
      if (pattern !== '_default' && message.includes(pattern)) {
        return safeMessage;
      }
    }
    
    // Use generic message for unrecognized errors
    return SAFE_ERROR_MESSAGES._default;
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
  
  toJSON(options = {}) {
    const json = super.toJSON(options);
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
  toJSON(options = {}) {
    if (this.validationErrors.length === 0) {
      return [super.toJSON(options)];
    }
    
    const { sanitize = isProduction() } = options;
    
    return this.validationErrors.map(err => {
      const error = {
        status: '422',
        code: err.code || 'VALIDATION_ERROR',
        title: 'Validation Error',
        detail: err.message, // Validation messages are always safe
        source: { pointer: `/data/attributes/${err.field}` },
        meta: {
          field: err.field
        }
      };
      
      // Only include field value in development
      if (!sanitize) {
        error.meta.value = err.value;
        if (err.meta) {
          error.meta = { ...error.meta, ...err.meta };
        }
      }
      
      return error;
    });
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
  
  toJSON(options = {}) {
    const json = super.toJSON(options);
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
  
  toJSON(options = {}) {
    const json = super.toJSON(options);
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
  INVALID_REFERENCE: 'INVALID_REFERENCE',
  
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
 * Sanitize an error for production
 */
export function sanitizeError(error, options = {}) {
  const apiError = normalizeError(error);
  const { forceProduction = false, forceDevelopment = false } = options;
  
  let sanitize = isProduction();
  if (forceProduction) sanitize = true;
  if (forceDevelopment) sanitize = false;
  
  // Log full error details server-side before sanitizing
  if (sanitize && apiError.status >= 500) {
    console.error('[ERROR]', {
      timestamp: new Date().toISOString(),
      code: apiError.code,
      message: apiError.message,
      context: apiError.context,
      stack: apiError.stack
    });
  }
  
  return apiError;
}

/**
 * Format errors for JSON:API response
 */
export function formatErrorResponse(error, options = {}) {
  const apiError = sanitizeError(error, options);
  
  // Determine sanitization setting
  let sanitize = isProduction();
  if (options.forceProduction) sanitize = true;
  if (options.forceDevelopment) sanitize = false;
  if (options.sanitize !== undefined) sanitize = options.sanitize;
  
  return {
    errors: Array.isArray(apiError.toJSON({ sanitize })) 
      ? apiError.toJSON({ sanitize }) 
      : [apiError.toJSON({ sanitize })]
  };
}