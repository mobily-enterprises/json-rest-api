import {
  RestApiWriteError, RestApiValidationError, RestApiResourceError,
  RestApiVersionConflictError, RestApiPreconditionFailedError,
  RestApiPayloadError, RestApiFieldsetError, RestApiIncludeError,
  RestApiTemporalDataError
} from '../../types/errors.js'

const stale: RestApiResourceError = new RestApiVersionConflictError({ resourceType: 'items', resourceId: '1' })
const http: RestApiResourceError = new RestApiPreconditionFailedError({ resourceId: 1 })
const wrapped = new RestApiWriteError('Write failed', { cause: stale, transactionOutcome: 'rolledBack' })
const validation = new RestApiValidationError('Invalid', { violations: [{ field: 'name', rule: 'required', message: 'Required' }] })
const json: string = JSON.stringify([
  http.toJSON(), wrapped.toJSON(), validation.toJSON(),
  new RestApiPayloadError('Invalid', { received: null, cause: 42 }).toJSON(),
  new RestApiFieldsetError({ field: 'name' }).toJSON(),
  new RestApiIncludeError({ path: 'children' }).toJSON(),
  new RestApiTemporalDataError({ source: 'getter', fieldType: 'date' }).toJSON()
])
void json

// @ts-expect-error The runtime requires an explicit valid transaction outcome.
new RestApiWriteError('Missing outcome')
// @ts-expect-error Outcomes are the documented finite states.
new RestApiWriteError('Invalid outcome', { transactionOutcome: 'failed' })
// @ts-expect-error The transaction outcome is not writable at runtime.
wrapped.transactionOutcome = 'committed'
// @ts-expect-error A captured cause is unknown until narrowed.
wrapped.cause.message
// @ts-expect-error Forwarded cause fields are not guaranteed strings.
wrapped.code.toLowerCase()
// @ts-expect-error Resource identifiers cannot be arrays.
new RestApiPreconditionFailedError({ resourceId: ['1'] })
// @ts-expect-error Validation violations need a message and field.
new RestApiValidationError('Invalid', { violations: [{ field: 'name' }] })
