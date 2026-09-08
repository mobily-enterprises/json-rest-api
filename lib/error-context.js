import { HookedApiError } from 'hooked-api'

export function isRestApiError (error) {
  return error instanceof HookedApiError
}

/**
 * Add operational context to unexpected failures without erasing typed API
 * errors that callers and transports need to classify.
 */
export function wrapUnexpectedError (error, { message, context } = {}) {
  if (isRestApiError(error)) {
    return error
  }

  const wrappedError = new Error(`${message}: ${error.message}`, {
    cause: error
  })
  wrappedError.context = context
  return wrappedError
}
