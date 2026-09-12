// @ts-check
import { RestApiValidationError } from '../../../lib/rest-api-errors.js'

/**
 * addRoute
 * Registers a new route with the transport layer
 */
/** @param {import('../../../types/runtime.js').RuntimeArguments} args */
export default async ({ params, context, runHooks }) => {
  const { method, path, handler } = params

  if (!method || !path || !handler) {
    throw new RestApiValidationError('Route requires method, path, and handler')
  }

  Object.assign(context, params)

  await runHooks('addRoute')

  return { registered: true, method, path }
}
