const JSON_API_WRITE_CONTENT_TYPES = [
  'application/vnd.api+json',
  'application/json'
]

export function isWriteMethod (method) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method || '').toUpperCase())
}

export function getAllowedWriteContentTypes ({ allowMultipart = false } = {}) {
  return allowMultipart
    ? [...JSON_API_WRITE_CONTENT_TYPES, 'multipart/form-data']
    : [...JSON_API_WRITE_CONTENT_TYPES]
}

export function isAllowedWriteContentType (contentType, { allowMultipart = false } = {}) {
  if (!contentType) return true

  return getAllowedWriteContentTypes({ allowMultipart })
    .some((allowedType) => contentType.includes(allowedType))
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
  let status = 500
  let errors = [{
    status: '500',
    title: 'Internal Server Error',
    detail: error.message
  }]

  if (error?.validation) {
    status = 400
    errors = error.validation.map((issue) => ({
      status: '400',
      title: 'Bad Request',
      detail: issue.message,
      ...(issue.instancePath ? { source: { pointer: issue.instancePath } } : {})
    }))
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
    status = 400
    errors = [{
      status: '400',
      title: 'Bad Request',
      detail: error.message,
      ...(error.path ? { source: { pointer: error.path } } : {})
    }]
  } else if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
    status = error.statusCode
    errors = [{
      status: String(status),
      title: status === 415 ? 'Unsupported Media Type' : 'Bad Request',
      detail: error.message
    }]
  }

  return {
    status,
    body: { errors }
  }
}
