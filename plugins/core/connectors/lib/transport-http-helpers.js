import {
  RestApiWriteError,
  REST_API_FIELDSET_ERROR_CODE,
  REST_API_INCLUDE_ERROR_CODE,
  REST_API_TEMPORAL_DATA_ERROR_CODE
} from '../../../../lib/rest-api-errors.js'
import { isRestApiError } from '../../../../lib/error-context.js'
import { parse as parseContentType } from 'content-type'
import vary from 'vary'

export function mergeResponseHeaders (...sources) {
  const headers = new Map()
  for (const source of sources) {
    for (const [name, value] of Object.entries(source || {})) {
      if (value === undefined || value === null) continue
      const key = name.toLowerCase()
      headers.set(key, key === 'vary' ? vary.append(headers.get(key) || '', value) : value)
    }
  }
  return Object.fromEntries(headers)
}

export function getHttpDiagnosticError (error) {
  // Parser messages and stacks can quote raw input before a resource is known.
  // Keep the original error for hooks/responses, but log only this safe preview.
  if (error?.type === 'entity.parse.failed') {
    return { name: 'SyntaxError', message: 'Invalid JSON request body', type: 'entity.parse.failed', status: 400 }
  }
  // A database error repeats the stored values: in the message Knex builds
  // from the SQL and its bindings, in MySQL's sql and sqlMessage, and in
  // PostgreSQL's detail. Log only which failure it was.
  const failure = databaseFailure(error)
  return failure ? { name: failure.name, code: failure.code } : error
}

/**
 * The database driver error behind `error`, which may wrap it as its cause
 * (a RestApiWriteError does).
 * @param {unknown} error
 */
function databaseFailure (error) {
  let current = error
  for (let depth = 0; current && typeof current === 'object' && depth < 10; depth++) {
    if (!isRestApiError(current)) {
      const { sqlState, sqlMessage, errno, severity, code } = /** @type {any} */ (current)
      // mysql2 (and socket) errors, pg errors, and better-sqlite3 or sqlite3 errors.
      if (typeof sqlState === 'string' || typeof sqlMessage === 'string' || typeof errno === 'number' ||
        typeof severity === 'string' || /^SQLITE_/.test(String(code ?? ''))) return current
    }
    current = /** @type {any} */ (current).cause
  }
}

const JSON_API_WRITE_CONTENT_TYPES = [
  'application/vnd.api+json',
  'application/json'
]

export function isWriteMethod (method) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method || '').toUpperCase())
}

export function isMultipartContentType (contentType) {
  try { return parseContentType(contentType).type === 'multipart/form-data' } catch { return false }
}

export function getAllowedWriteContentTypes ({ allowMultipart = false } = {}) {
  return allowMultipart
    ? [...JSON_API_WRITE_CONTENT_TYPES, 'multipart/form-data']
    : [...JSON_API_WRITE_CONTENT_TYPES]
}

export function isAllowedWriteContentType (contentType, { allowMultipart = false } = {}) {
  if (!contentType) return true
  try {
    const media = parseContentType(contentType)
    return getAllowedWriteContentTypes({ allowMultipart }).includes(media.type) &&
      (media.type !== JSON_API_WRITE_CONTENT_TYPES[0] || Object.keys(media.parameters).every(key => key === 'profile'))
  } catch { return false }
}

export function acceptsJsonApi (accept) {
  if (accept === undefined) return true
  // Split only between media ranges; quoted profile URIs can contain commas.
  const ranges = (String(accept).match(/(?:[^,"]|"(?:\\.|[^"\\])*")+/g) || []).flatMap(value => {
    try { return [parseContentType(value.trim())] } catch { return [] }
  })
  const vendorType = JSON_API_WRITE_CONTENT_TYPES[0]
  const validParameters = media => Object.keys(media.parameters).every(key => ['profile', 'q'].includes(key))
  const vendorRanges = ranges.filter(media => media.type === vendorType)
  if (vendorRanges.length && !vendorRanges.some(validParameters)) return false
  const matches = ranges.flatMap(media => {
    const specificity = [vendorType, 'application/*', '*/*'].indexOf(media.type)
    if (specificity < 0 || !validParameters(media)) return []
    const q = media.parameters.q ?? '1'
    const quality = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(q) ? Number(q) : 0
    return [{ specificity, quality }]
  })
  matches.sort((a, b) => a.specificity - b.specificity || b.quality - a.quality)
  return (matches[0]?.quality || 0) > 0
}

export function getNotAcceptableErrorBody () {
  return { errors: [{ status: '406', title: 'Not Acceptable', detail: 'Accept must allow application/vnd.api+json without unsupported parameters or extensions' }] }
}

export function getNotFoundErrorBody (method, url) {
  return { errors: [{ status: '404', title: 'Not Found', detail: `The requested endpoint ${method} ${url} does not exist` }] }
}

export function getUnsupportedMediaTypeErrorBody ({ allowMultipart = false } = {}) {
  const acceptedTypes = getAllowedWriteContentTypes({ allowMultipart }).join(' or ')

  return {
    errors: [{
      status: '415',
      title: 'Unsupported Media Type',
      detail: `Content-Type must be ${acceptedTypes}`
    }]
  }
}

export function determineResponseStatus (method, result) {
  const upperMethod = String(method || '').toUpperCase()

  if (result && typeof result.statusCode === 'number') {
    return result.statusCode
  }

  if (upperMethod === 'POST' && result) return 201
  if (upperMethod === 'POST' && !result) return 204
  if (upperMethod === 'DELETE') return 204
  if ((upperMethod === 'PUT' || upperMethod === 'PATCH') && !result) return 204

  return 200
}

export function mapRestApiErrorToHttp (error) {
  // Read hooks can reject with null or undefined.
  error ??= {}
  const statusHint = error.statusCode ?? error.status
  // Only the library's own errors carry messages meant for clients; a write
  // error wraps what failed. Other messages, a database's above all, can
  // repeat SQL and stored values.
  const origin = isRestApiError(error) && error instanceof RestApiWriteError ? error.cause : error
  let status = 500
  let errors = [{
    status: '500',
    title: 'Internal Server Error',
    detail: isRestApiError(origin) ? error.message : 'An unexpected error occurred'
  }]

  if (error?.validation) {
    status = 400
    errors = error.validation.map((issue) => ({
      status: '400',
      title: 'Bad Request',
      detail: issue.message,
      ...(issue.instancePath ? { source: { pointer: issue.instancePath } } : {})
    }))
  } else if (error.code === REST_API_FIELDSET_ERROR_CODE) {
    status = 400
    errors = [{
      status: '400',
      code: error.code,
      title: 'Invalid Sparse Fieldset',
      detail: error.message
    }]
  } else if (error.code === REST_API_INCLUDE_ERROR_CODE) {
    status = 400
    errors = [{
      status: '400',
      code: error.code,
      title: 'Invalid Include Path',
      detail: error.message,
      source: { parameter: 'include' }
    }]
  } else if (error.code === REST_API_TEMPORAL_DATA_ERROR_CODE) {
    status = 500
    errors = [{
      status: '500',
      code: error.code,
      title: 'Invalid Temporal Data',
      detail: error.message
    }]
  } else if (error.code === 'REST_API_VALIDATION') {
    status = 422
    if (error.details?.violations?.length) {
      errors = error.details.violations.map((violation) => ({
        status: '422',
        title: 'Validation Error',
        detail: violation.message,
        source: { pointer: violation.field }
      }))
    } else {
      errors = [{
        status: '422',
        title: 'Validation Error',
        detail: error.message,
        ...(error.details ? { source: error.details } : {})
      }]
    }
  } else if (error.code === 'REST_API_BULK_WRITE_UNSUPPORTED') {
    status = 422
    errors = [{ status: '422', code: error.code, title: 'Unsupported Bulk Write', detail: error.message }]
  } else if (error.code === 'REST_API_PRECONDITION_FAILED') {
    status = 412
    errors = [{ status: '412', code: error.code, title: 'Precondition Failed', detail: error.message }]
  } else if (error.code === 'REST_API_VERSION_CONFLICT') {
    status = 409
    errors = [{ status: '409', code: error.code, title: 'Version Conflict', detail: error.message }]
  } else if (error.code === 'REST_API_RESOURCE') {
    switch (error.subtype) {
      case 'not_found':
        status = 404
        errors = [{ status: '404', title: 'Not Found', detail: error.message }]
        break
      case 'conflict':
        status = 409
        errors = [{ status: '409', title: 'Conflict', detail: error.message }]
        break
      case 'forbidden':
        status = 403
        errors = [{ status: '403', title: 'Forbidden', detail: error.message }]
        break
      default:
        status = 400
        errors = [{ status: '400', title: 'Bad Request', detail: error.message }]
    }
  } else if (error.code === 'REST_API_PAYLOAD') {
    status = error.statusCode === 413 ? 413 : 400
    errors = [{
      status: String(status),
      title: status === 413 ? 'Content Too Large' : 'Bad Request',
      detail: error.message,
      ...(error.parameter ? { source: { parameter: error.parameter } } : error.path ? { source: { pointer: error.path } } : {})
    }]
  } else if (typeof statusHint === 'number' && statusHint >= 400 && statusHint < 500) {
    status = statusHint
    errors = [{
      status: String(status),
      title: status === 415 ? 'Unsupported Media Type' : 'Bad Request',
      detail: error.message
    }]
  }

  if (isRestApiError(error) && error instanceof RestApiWriteError) {
    errors = errors.map(item => ({ ...item, meta: { ...item.meta, transactionOutcome: error.transactionOutcome } }))
  }

  return {
    status,
    body: { errors }
  }
}
