// @ts-check
/** @import { HookContext, PermissionHookContext } from '../../../types/hook-context.js' */

/**
 * Run the resource permission hook with the originating operation context.
 * @param {object} request
 * @param {Record<string, unknown>} request.context
 * @param {{ method: string, originalContext: HookContext }} request.params
 * @param {(name: 'checkPermissions') => unknown} request.runHooks
 */
export default async function checkPermissionsMethod ({ context, params, runHooks }) {
  const permissionContext = /** @satisfies {PermissionHookContext} */ ({
    method: params.method,
    originalContext: params.originalContext,
  })
  Object.assign(context, permissionContext)

  await runHooks('checkPermissions')
}
