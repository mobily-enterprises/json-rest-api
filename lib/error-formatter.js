/**
 * Error formatting utility for comprehensive error logging
 * Serializes errors with all their properties including custom fields like violations
 */

/**
 * Formats an error object for logging, including all enumerable properties
 * @param {Error} error - The error to format
 * @param {Object} options - Formatting options
 * @param {boolean} options.includeStack - Whether to include stack trace (default: true)
 * @param {number} options.maxDepth - Maximum depth for nested objects (default: 5)
 * @returns {Object} Formatted error object safe for JSON serialization
 */
export function formatError (error, options = {}) {
  const { includeStack = true, maxDepth = 5 } = options

  if (!error) {
    return null
  }

  // Handle circular references
  const seen = new WeakSet()

  function serialize (obj, depth = 0) {
    if (depth > maxDepth) {
      return '[Max depth exceeded]'
    }

    if (obj === null || obj === undefined) {
      return obj
    }

    if (typeof obj !== 'object') {
      return obj
    }

    if (seen.has(obj)) {
      return '[Circular reference]'
    }

    if (obj instanceof Date) {
      return obj.toISOString()
    }

    if (obj instanceof RegExp) {
      return obj.toString()
    }

    seen.add(obj)

    if (Array.isArray(obj)) {
      return obj.map(item => serialize(item, depth + 1))
    }

    const result = {}
    for (const key of Object.keys(obj)) {
      try {
        result[key] = serialize(obj[key], depth + 1)
      } catch (e) {
        result[key] = `[Error serializing: ${e.message}]`
      }
    }

    return result
  }

  // Start with basic error properties
  const formatted = {
    name: error.name || 'Error',
    message: error.message || '',
    ...(includeStack && error.stack ? { stack: error.stack } : {})
  }

  // If error has a toJSON method, use it
  if (typeof error.toJSON === 'function') {
    try {
      const jsonError = error.toJSON()
      Object.assign(formatted, serialize(jsonError))
    } catch (e) {
      formatted.toJSONError = `Failed to call toJSON: ${e.message}`
    }
  }

  // Add all enumerable properties
  for (const key of Object.keys(error)) {
    if (!(key in formatted)) {
      try {
        formatted[key] = serialize(error[key])
      } catch (e) {
        formatted[key] = `[Error serializing: ${e.message}]`
      }
    }
  }

  // Ensure specific error properties are included
  const importantProps = ['code', 'type', 'details', 'violations', 'subtype', 'path', 'fields']
  for (const prop of importantProps) {
    if (error[prop] !== undefined && !(prop in formatted)) {
      try {
        formatted[prop] = serialize(error[prop])
      } catch (e) {
        formatted[prop] = `[Error serializing: ${e.message}]`
      }
    }
  }

  return formatted
}

/**
 * Formats an error as a human-readable string with indentation
 * @param {Error} error - The error to format
 * @param {Object} options - Formatting options
 * @returns {string} Formatted error string
 */
export function formatErrorString (error, options = {}) {
  const formatted = formatError(error, options)
  return JSON.stringify(formatted, null, 2)
}

/**
 * Creates a one-line summary of an error including key details
 * @param {Error} error - The error to summarize
 * @returns {string} One-line error summary
 */
export function formatErrorSummary (error) {
  if (!error) return 'Unknown error'

  const parts = [error.message || 'No message']

  if (error.code) {
    parts.push(`code: ${error.code}`)
  }

  if (error.details?.violations && Array.isArray(error.details.violations) && error.details.violations.length > 0) {
    const violationSummary = error.details.violations
      .map(v => `${v.field}: ${v.message}`)
      .join(', ')
    parts.push(`violations: [${violationSummary}]`)
  }

  if (error.details?.fields && Array.isArray(error.details.fields) && error.details.fields.length > 0) {
    parts.push(`fields: ${error.details.fields.join(', ')}`)
  }

  return parts.join(' | ')
}
