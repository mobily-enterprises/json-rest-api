// @ts-check
/**
 * release
 * Runs the hook that tells plugins to release resources
 */
/** @param {import('../../../types/runtime.js').RuntimeArguments} args */
export default async ({ runHooks }) => {
  await runHooks('release')

  return { }
}
