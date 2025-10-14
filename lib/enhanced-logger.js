/**
 * Enhanced logger wrapper that automatically serializes errors with full details
 * Wraps any logger to provide comprehensive error logging
 */

import { formatError, formatErrorSummary, formatErrorString } from './error-formatter.js'

/**
 * Creates an enhanced logger that automatically formats errors
 * @param {Object} baseLogger - The base logger to wrap (must have debug, info, warn, error methods)
 * @param {Object} options - Configuration options
 * @param {boolean} options.logFullErrors - Whether to log full error details (default: true)
 * @param {boolean} options.includeStack - Whether to include stack traces (default: true)
 * @returns {Object} Enhanced logger with automatic error formatting
 */
export function createEnhancedLogger (baseLogger, options = {}) {
  const {
    logFullErrors = true,
    includeStack = true
  } = options

  // Helper to process arguments and format errors
  function processArgs (args) {
    return args.map(arg => {
      // If it's an error object, format it
      if (arg instanceof Error) {
        if (logFullErrors) {
          return formatError(arg, { includeStack })
        } else {
          return formatErrorSummary(arg)
        }
      }

      // If it's an object with an error property, format the error
      if (arg && typeof arg === 'object' && arg.error instanceof Error) {
        return {
          ...arg,
          error: logFullErrors
            ? formatError(arg.error, { includeStack })
            : formatErrorSummary(arg.error)
        }
      }

      return arg
    })
  }

  // Create wrapper methods for each log level
  const enhancedLogger = {}

  // Common log levels
  const logLevels = ['debug', 'info', 'warn', 'error', 'trace', 'fatal', 'log']

  for (const level of logLevels) {
    if (typeof baseLogger[level] === 'function') {
      enhancedLogger[level] = function (...args) {
        const processedArgs = processArgs(args)

        // Special handling for error level - always log full details
        if (level === 'error' && args.some(arg => arg instanceof Error || (arg?.error instanceof Error))) {
          // Log a formatted version as well for better readability
          const errors = args.filter(arg => arg instanceof Error || arg?.error instanceof Error)
          for (const errorArg of errors) {
            const error = errorArg instanceof Error ? errorArg : errorArg.error
            if (error.details?.violations && Array.isArray(error.details.violations) && error.details.violations.length > 0) {
              // Log violations in a readable format
              baseLogger[level]('Validation error details:', {
                message: error.message,
                violations: error.details.violations.map(v => ({
                  field: v.field,
                  rule: v.rule,
                  message: v.message
                }))
              })
            }
          }
        }

        return baseLogger[level](...processedArgs)
      }
    }
  }

  // Preserve any other properties/methods from the base logger
  for (const key in baseLogger) {
    if (!(key in enhancedLogger)) {
      enhancedLogger[key] = baseLogger[key]
    }
  }

  // Add utility methods
  enhancedLogger.logError = function (message, error, additionalData = {}) {
    const errorData = formatError(error, { includeStack })
    this.error(message, {
      ...additionalData,
      error: errorData,
      errorSummary: formatErrorSummary(error)
    })
  }

  enhancedLogger.logValidationError = function (message, error, additionalData = {}) {
    if (error.details?.violations && Array.isArray(error.details.violations)) {
      this.error(message, {
        ...additionalData,
        message: error.message,
        code: error.code,
        violations: error.details.violations,
        fields: error.details?.fields || [],
        fullError: formatError(error, { includeStack: false })
      })
    } else {
      this.logError(message, error, additionalData)
    }
  }

  return enhancedLogger
}

/**
 * Middleware to enhance an existing logger instance
 * Can be used to patch global loggers
 */
export function enhanceLogger (logger, options = {}) {
  const enhanced = createEnhancedLogger(logger, options)

  // Replace methods on the original logger
  for (const key in enhanced) {
    if (typeof enhanced[key] === 'function') {
      logger[key] = enhanced[key]
    }
  }

  return logger
}
