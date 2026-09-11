import { RestApiValidationError } from '../../../lib/rest-api-errors.js'

/**
 * addRoute
 * Registers a new route with the transport layer
 */
export default async ({ params, context, runHooks }) => {
  const { method, path, handler } = params

  // Validate route configuration
  if (!method || !path || !handler) {
    throw new RestApiValidationError('Route requires method, path, and handler')
  }

  // debugger
  // Create context for enrichAttributes hooks
  Object.assign(context, params)

  // Run the addRoute hook to notify transport plugins
  await runHooks('addRoute')

  return { registered: true, method, path }
}
