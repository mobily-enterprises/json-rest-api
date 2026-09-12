// @ts-check
/** @import { DiagnosticLogger, DiagnosticOptions, EnhancedDiagnosticLogger, DiagnosticWriter } from './logger-types.js' */

import { isErrorObject } from './error-context.js'
import { formatDiagnosticValue, formatError, formatErrorSummary, readDiagnosticProperty } from './error-formatter.js'

/**
 * @template {DiagnosticLogger} Logger
 * @overload
 * @param {Logger & { error: DiagnosticWriter }} baseLogger
 * @param {DiagnosticOptions} [options]
 * @returns {EnhancedDiagnosticLogger & { error: DiagnosticWriter }}
 */
/**
 * @template {DiagnosticLogger} Logger
 * @overload
 * @param {Logger} baseLogger
 * @param {DiagnosticOptions} [options]
 * @returns {EnhancedDiagnosticLogger}
 */
/**
 * Bound diagnostic previews and apply compiled field visibility to supplied levels.
 * @param {DiagnosticLogger} baseLogger
 * @param {DiagnosticOptions} [options]
 * @returns {EnhancedDiagnosticLogger}
 */
export function createEnhancedLogger (baseLogger, options = {}) {
  const {
    logFullErrors = true,
    includeStack = true,
    redactFields = [],
    schemaInfo
  } = options
  const hiddenFields = Object.entries(schemaInfo?.outputFields || {})
    .filter(([, definition]) => definition.hidden === true || definition.normallyHidden === true)
    .map(([field]) => field)
  const diagnosticOptions = { includeStack, redactFields: [...redactFields, ...hiddenFields] }
  const formatLoggedError = logFullErrors ? formatError : formatErrorSummary

  /** @param {unknown} arg */
  function formatArgument (arg) {
    try {
      if (isErrorObject(arg)) return formatLoggedError(arg, diagnosticOptions)
      if (!arg || typeof arg !== 'object' || diagnosticOptions.redactFields.includes('error')) return arg

      /** @type {unknown} */
      const nestedError = Object.getOwnPropertyDescriptor(arg, 'error')?.value
      if (!isErrorObject(nestedError)) return arg
      /** @type {object} */
      const metadata = Object(formatDiagnosticValue(arg, diagnosticOptions))
      if (!Object.hasOwn(metadata, 'error')) return metadata
      return {
        ...metadata,
        error: formatLoggedError(nestedError, diagnosticOptions)
      }
    } catch {
      // The final shared formatter contains values that cannot even be classified.
      return arg
    }
  }

  // Create wrapper methods for each log level
  /** @type {DiagnosticLogger & Record<string, unknown>} */
  const enhancedLogger = {}

  const logLevels = /** @type {const} */ (['debug', 'info', 'warn', 'error', 'trace', 'fatal', 'log'])

  for (const level of logLevels) {
    if (typeof baseLogger[level] !== 'function') continue
    // Capture before enhanceLogger replaces methods on the same object.
    const write = baseLogger[level].bind(baseLogger)
    enhancedLogger[level] = function (...args) {
      const processedArgs = args.slice(0, 50).map(formatArgument)
      if (args.length > 50) processedArgs.push('[Truncated]')
      const formatted = formatDiagnosticValue(processedArgs, diagnosticOptions)
      return write(...(Array.isArray(formatted) ? formatted : [formatted]))
    }
  }

  // Preserve any other properties/methods from the base logger
  for (const key in baseLogger) {
    if (!(key in enhancedLogger)) {
      enhancedLogger[key] = Reflect.get(baseLogger, key)
    }
  }

  /** @type {EnhancedDiagnosticLogger['logError']} */
  const logError = function (message, error, additionalData = {}) {
    const errorData = formatError(error, diagnosticOptions)
    /** @type {object} */
    const metadata = Object(formatDiagnosticValue(additionalData, diagnosticOptions))
    return this.error(message, {
      ...metadata,
      error: errorData,
      errorSummary: formatErrorSummary(error, diagnosticOptions)
    })
  }

  /** @type {EnhancedDiagnosticLogger['logValidationError']} */
  const logValidationError = function (message, error, additionalData = {}) {
    const details = diagnosticOptions.redactFields.includes('details') ? undefined : readDiagnosticProperty(error, 'details')
    const violations = diagnosticOptions.redactFields.includes('violations') ? undefined : readDiagnosticProperty(details, 'violations')
    if (!Array.isArray(violations)) return this.logError(message, error, additionalData)
    const formatted = formatError(error, { ...diagnosticOptions, includeStack: false })
    const formattedDetails = readDiagnosticProperty(formatted, 'details')
    /** @type {object} */
    const metadata = Object(formatDiagnosticValue(additionalData, diagnosticOptions))
    return this.error(message, {
      ...metadata,
      message: readDiagnosticProperty(formatted, 'message'),
      code: readDiagnosticProperty(formatted, 'code'),
      violations: readDiagnosticProperty(formattedDetails, 'violations'),
      fields: readDiagnosticProperty(formattedDetails, 'fields') || [],
      fullError: formatted
    })
  }

  return Object.assign(enhancedLogger, { logError, logValidationError })
}

/**
 * Middleware to enhance an existing logger instance
 * Can be used to patch global loggers
 * @template {DiagnosticLogger} Logger
 * @param {Logger} logger
 * @param {DiagnosticOptions} [options]
 * @returns {Logger}
 */
export function enhanceLogger (logger, options = {}) {
  const enhanced = createEnhancedLogger(logger, options)

  // Replace methods on the original logger
  for (const key in enhanced) {
    if (typeof enhanced[key] === 'function') {
      Object.assign(logger, { [key]: enhanced[key] })
    }
  }

  return logger
}
