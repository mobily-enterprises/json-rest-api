// @ts-check
import { createEnhancedLogger, enhanceLogger } from '../../lib/enhanced-logger.js'
import { formatDiagnosticValue, formatError, formatErrorSummary, readDiagnosticProperty } from '../../lib/error-formatter.js'

/** @param {unknown} failure */
export function checkDiagnosticLogger (failure) {
  const logger = createEnhancedLogger({ error: (...args) => Promise.resolve(args.length) }, {
    redactFields: /** @type {const} */ (['privateField']),
    schemaInfo: { outputFields: { privateField: { type: 'string', hidden: true } } }
  })
  const result = logger.logError('Operation failed', failure, { phase: 'write' })
  logger.logValidationError('Validation failed', failure)
  createEnhancedLogger(console).logError('Operation failed', failure)
  createEnhancedLogger({ error: (...args) => args.length, label: 'fixture' }).logError('Failed', failure)
  const patched = enhanceLogger({ error: (...args) => args.length, label: 'fixture' })
  patched.error(failure).toFixed()
  patched.label.toUpperCase()
  const warnings = createEnhancedLogger({ warn: (...args) => args.length })
  warnings.warn?.('Warning', failure)
  // @ts-expect-error A warning-only logger has no guaranteed error writer.
  warnings.logError('Failure', failure)
  // @ts-expect-error Writer results are unknown, not guaranteed promises.
  result.then(() => {})
  // @ts-expect-error Level members must be callable.
  createEnhancedLogger({ warn: 'disabled' })
  // @ts-expect-error Redaction field names are strings.
  createEnhancedLogger({}, { redactFields: [42] })
  // @ts-expect-error Compiled visibility is boolean metadata.
  createEnhancedLogger({}, { schemaInfo: { outputFields: { secret: { hidden: 'yes' } } } })
  // @ts-expect-error The wrapper does not forward a configurable depth limit.
  createEnhancedLogger({}, { maxDepth: 100 })
  // @ts-expect-error Convenience metadata is an object.
  logger.logError('Failure', failure, 42)
  const formatted = formatError(failure, { redactFields: ['secret'] })
  if (formatted) formatErrorSummary(formatted)
  // @ts-expect-error Falsy thrown values can produce null diagnostics.
  String(formatted.message)
  const diagnostic = formatDiagnosticValue(failure, { maxDepth: 2, redactFields: ['secret'] })
  // @ts-expect-error Diagnostic serialization can return primitives, arrays or undefined.
  String(diagnostic.message)
  const knownError = formatError(new Error('Known'))
  // @ts-expect-error Custom error serialization can change even the message's value type.
  knownError.message.toUpperCase()
  const property = readDiagnosticProperty(failure, 'message')
  // @ts-expect-error A guarded property read still has an unknown value.
  property.toUpperCase()
  readDiagnosticProperty(['first'], 0)
  // @ts-expect-error Formatter limits are numeric.
  formatDiagnosticValue(failure, { maxDepth: 'deep' })
}
