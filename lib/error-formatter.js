// @ts-check
/** @import { DiagnosticPrimitive, DiagnosticValue, DiagnosticObject, DiagnosticFormattingOptions } from './logger-types.js' */
/**
 * Error formatting utility for comprehensive error logging
 * Serializes errors with all their properties including custom fields like violations
 */

import { errorMessage, getBinaryDiagnostic } from './error-context.js'

/** @param {unknown} object @param {string | number} key @returns {unknown} */
export function readDiagnosticProperty (object, key) {
  try { return object == null ? undefined : Reflect.get(Object(object), key) } catch (error) {
    return `[Error reading ${key}: ${errorMessage(error)}]`
  }
}

/** @param {DiagnosticFormattingOptions} [options] */
function createDiagnosticFormatter ({ includeStack = true, maxDepth = 5, redactFields = [] } = {}) {
  const redactedFields = new Set(redactFields)
  /** @param {string} key */
  const isRedacted = key => redactedFields.has(key)
  const includeErrorStack = includeStack && !isRedacted('name') && !isRedacted('message')
  const redactedPaths = new Set([...redactedFields].map(field => `data.attributes.${field}`))
  // Handle circular references
  const seen = new WeakSet()
  let remainingNodes = 256
  let remainingText = 8192
  const maxEntries = 50

  /** @overload @param {string} value @returns {string} */
  /** @overload @param {unknown} value @returns {DiagnosticPrimitive} */
  /** @param {unknown} value @returns {DiagnosticPrimitive} */
  function boundedText (value) {
    if (typeof value === 'string') {
      const limit = Math.min(2048, remainingText)
      remainingText -= Math.min(value.length, limit)
      return value.length > limit ? `${value.slice(0, limit)}[Truncated]` : value
    }
    if (value == null || typeof value === 'number' || typeof value === 'boolean') return value
    if (typeof value === 'bigint' || typeof value === 'symbol') return boundedText(String(value))
    if (typeof value === 'function') return '[Function]'
    return '[Non-string diagnostic text]'
  }

  /** @param {DiagnosticObject} target @param {string} key @param {DiagnosticValue} value */
  function setValue (target, key, value) {
    Object.defineProperty(target, boundedText(key), { value: isRedacted(key) ? '[Redacted]' : value, enumerable: true, writable: true, configurable: true })
  }

  /** @param {unknown} object @param {string} key */
  function readProperty (object, key) {
    if (isRedacted(key)) return '[Redacted]'
    return readDiagnosticProperty(object, key)
  }

  /** @param {unknown} error @returns {DiagnosticObject} */
  function errorMetadata (error) {
    // Native stack formatting can invoke name/message getters and repeat their values.
    const stack = includeErrorStack ? readProperty(error, 'stack') : undefined
    return {
      name: boundedText(readProperty(error, 'name') || 'Error'),
      message: boundedText(readProperty(error, 'message') || ''),
      ...(stack ? { stack: boundedText(stack) } : {})
    }
  }

  /** @param {unknown} obj @param {number} [depth] @param {boolean} [omitStack] @returns {DiagnosticValue} */
  function serialize (obj, depth = 0, omitStack = false) {
    try {
      return serializeValue(obj, depth, omitStack)
    } catch (error) {
      return boundedText(`[Error serializing: ${errorMessage(error)}]`)
    }
  }

  /** @param {unknown} obj @param {number} depth @param {boolean} omitStack @returns {DiagnosticValue} */
  function serializeValue (obj, depth, omitStack) {
    if (remainingNodes-- <= 0) return '[Truncated]'
    if (depth > maxDepth) {
      return '[Max depth exceeded]'
    }

    if (obj === null || obj === undefined) {
      return obj
    }

    if (typeof obj !== 'object') {
      if (typeof obj === 'bigint' || typeof obj === 'symbol') return boundedText(String(obj))
      if (typeof obj === 'function') return '[Function]'
      return boundedText(obj)
    }

    const binary = getBinaryDiagnostic(obj)
    if (binary) return binary

    if (seen.has(obj)) {
      return '[Circular reference]'
    }

    if (obj instanceof Date) {
      return boundedText(obj.toISOString())
    }

    if (obj instanceof RegExp) {
      return boundedText(obj.toString())
    }

    seen.add(obj)

    if (Array.isArray(obj)) {
      const result = []
      for (let i = 0; i < obj.length; i++) {
        if (i >= maxEntries || remainingNodes <= 0 || remainingText <= 0) {
          result.push('[Truncated]')
          break
        }
        result.push(serialize(readDiagnosticProperty(obj, i), depth + 1, omitStack))
      }
      return result
    }

    const field = Object.getOwnPropertyDescriptor(obj, 'field')?.value
    if (typeof field === 'string' && (isRedacted(field) || redactedPaths.has(field))) {
      return { field: boundedText(field), rule: boundedText(Object.getOwnPropertyDescriptor(obj, 'rule')?.value), message: '[Redacted]' }
    }

    const isError = obj instanceof Error
    /** @type {DiagnosticObject} */
    const result = isError ? errorMetadata(obj) : {}
    const keys = new Set(Object.keys(obj))
    if (isError) {
      // Native causes and AggregateError members are not enumerable.
      if (Object.hasOwn(obj, 'cause')) keys.add('cause')
      if (Object.hasOwn(obj, 'errors')) keys.add('errors')
    }
    let entries = 0
    for (const key of keys) {
      if (entries++ >= maxEntries || remainingNodes <= 0 || remainingText <= 0) {
        result['[Truncated]'] = true
        break
      }
      if (key === 'stack' && (omitStack || (isError && !includeErrorStack))) continue
      if (isRedacted(key)) {
        setValue(result, key, '[Redacted]')
        continue
      }
      try {
        setValue(result, key, serialize(Reflect.get(obj, key), depth + 1, omitStack))
      } catch (e) {
        setValue(result, key, boundedText(`[Error serializing: ${errorMessage(e)}]`))
      }
    }

    return result
  }

  return { serialize, boundedText, setValue, readProperty, errorMetadata, includeErrorStack, isRedacted, maxEntries, hasBudget: () => remainingNodes > 0 && remainingText > 0 }
}

/**
 * Formats arbitrary diagnostic arguments with one shared preview budget.
 * @param {unknown} value
 * @param {DiagnosticFormattingOptions} [options]
 * @returns {DiagnosticValue}
 */
export function formatDiagnosticValue (value, options = {}) {
  return createDiagnosticFormatter(options).serialize(value)
}

/** @overload @param {object} error @param {DiagnosticFormattingOptions} [options] @returns {DiagnosticObject} */
/** @overload @param {unknown} error @param {DiagnosticFormattingOptions} [options] @returns {DiagnosticObject | null} */
/**
 * Formats an error object for logging, including all enumerable properties
 * @param {unknown} error - Error or non-Error thrown value.
 * @param {import('./logger-types.js').DiagnosticFormattingOptions} [options]
 * @returns {DiagnosticObject | null} Bounded diagnostic properties, or null for an absent/falsy error.
 */
export function formatError (error, options = {}) {
  if (!error) return null
  const binary = getBinaryDiagnostic(error)
  if (binary) return { name: 'Error', message: 'Binary value thrown', data: binary }
  const { serialize, boundedText, setValue, errorMetadata, includeErrorStack, isRedacted, maxEntries, hasBudget } = createDiagnosticFormatter(options)

  // Start with basic error properties
  const formatted = errorMetadata(error)

  // If error has a toJSON method, use it
  try {
    /** @type {unknown} */
    const toJSON = Reflect.get(Object(error), 'toJSON')
    if (typeof toJSON === 'function') {
      const jsonError = toJSON.call(error)
      const serialized = serialize(jsonError, 0, !includeErrorStack)
      if (serialized && typeof serialized === 'object') {
        for (const [key, value] of Object.entries(serialized)) setValue(formatted, key, value)
      } else if (serialized !== undefined) {
        formatted.toJSONResult = serialized
      }
    }
  } catch (e) {
    formatted.toJSONError = boundedText(`Failed to call toJSON: ${errorMessage(e)}`)
  }

  // Add all enumerable properties
  let entries = 0
  for (const key of Object.keys(error)) {
    if (entries++ >= maxEntries || !hasBudget()) {
      formatted['[Truncated]'] = true
      break
    }
    if (key === 'stack' && !includeErrorStack) continue
    if (isRedacted(key)) {
      setValue(formatted, key, '[Redacted]')
      continue
    }
    if (!(key in formatted)) {
      try {
        setValue(formatted, key, serialize(Reflect.get(Object(error), key)))
      } catch (e) {
        setValue(formatted, key, boundedText(`[Error serializing: ${errorMessage(e)}]`))
      }
    }
  }

  // Ensure specific error properties are included
  const importantProps = ['code', 'type', 'details', 'violations', 'subtype', 'path', 'fields', 'cause', 'errors']
  for (const prop of importantProps) {
    if (!hasBudget()) {
      formatted['[Truncated]'] = true
      break
    }
    if (isRedacted(prop) && Object.hasOwn(error, prop)) {
      formatted[prop] = '[Redacted]'
      continue
    }
    if (!(prop in formatted)) {
      try {
        const value = Reflect.get(Object(error), prop)
        if (value !== undefined) formatted[prop] = serialize(value)
      } catch (e) {
        formatted[prop] = boundedText(`[Error serializing: ${errorMessage(e)}]`)
      }
    }
  }

  return formatted
}

/**
 * Formats an error as a human-readable string with indentation
 * @param {unknown} error - The error to format
 * @param {DiagnosticFormattingOptions} [options]
 * @returns {string} Formatted error string
 */
export function formatErrorString (error, options = {}) {
  const formatted = formatError(error, options)
  return JSON.stringify(formatted, null, 2)
}

/**
 * Creates a one-line summary of an error including key details
 * @param {unknown} error - The error to summarize
 * @param {import('./logger-types.js').DiagnosticFormattingOptions} [options]
 * @returns {string} One-line error summary
 */
export function formatErrorSummary (error, options = {}) {
  if (!error) return 'Unknown error'

  const { readProperty } = createDiagnosticFormatter(options)
  const details = readProperty(error, 'details')
  const formatted = formatError({
    message: readProperty(error, 'message'),
    code: readProperty(error, 'code'),
    details: { violations: readProperty(details, 'violations'), fields: readProperty(details, 'fields') }
  }, { ...options, includeStack: false })
  /** @param {unknown} value */
  const text = value => typeof value === 'string' ? value : JSON.stringify(value)
  const parts = [text(formatted.message || 'No message')]

  if (formatted.code) {
    parts.push(`code: ${text(formatted.code)}`)
  }

  const formattedDetails = readDiagnosticProperty(formatted, 'details')
  const violations = readDiagnosticProperty(formattedDetails, 'violations')
  const fields = readDiagnosticProperty(formattedDetails, 'fields')
  if (Array.isArray(violations) && violations.length > 0) {
    const violationSummary = violations
      .map(v => v && typeof v === 'object' ? `${text(readDiagnosticProperty(v, 'field'))}: ${text(readDiagnosticProperty(v, 'message'))}` : text(v))
      .join(', ')
    parts.push(`violations: [${violationSummary}]`)
  }

  if (Array.isArray(fields) && fields.length > 0) {
    parts.push(`fields: ${fields.map(text).join(', ')}`)
  }
  if (formatted['[Truncated]']) parts.push('[Truncated]')

  const summary = parts.join(' | ')
  return summary.length > 2048 ? `${summary.slice(0, 2037)}[Truncated]` : summary
}
