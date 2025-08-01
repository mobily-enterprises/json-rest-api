import { ValidationError } from 'hooked-api';

/**
 * addRoute
 * Registers a new route with the transport layer
 */
export default async ({ params, context, runHooks }) => {
  const { method, path, handler } = params;
  
  // Validate route configuration
  if (!method || !path || !handler) {
    throw new ValidationError('Route requires method, path, and handler');
  }

  // debugger
  // Create context for enrichAttributes hooks
  Object.assign(context, params)
  
  // Run the addRoute hook to notify transport plugins
  await runHooks('addRoute');
  
  return { registered: true, method, path };
}