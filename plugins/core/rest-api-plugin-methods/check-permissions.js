/**
 * checkPermissions
 * Check if ther are permissions to access a resource.
 * 
 */
export default async function checkPermissionsMethod({ context, params, runHooks, scopeName, scopes, helpers }) {
 
  Object.assign(context, {
    method: params.method,
    originalContext: params.originalContext,
  })
  
  await runHooks('checkPermissions');
}