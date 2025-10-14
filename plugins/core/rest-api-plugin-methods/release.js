import { ValidationError } from 'hooked-api'

/**
 * release
 * Runs the hook that tells plugins to release resources
 */
export default async ({ runHooks }) => {
  // Run the addRoute hook to notify transport plugins
  await runHooks('release')

  return { }
}
