/**
 * checkPermissions
 * Check if ther are permissions to access a resource.
 * 
 */
export default async function checkPermissionsMethod({ context, params, runHooks, scopeName, scopes, helpers }) {
 
  Object.assign(context, {
    method: params.method,
    isUpdate: params.isUpdate,
    id: params.id,
    auth: params.auth,
    transaction: params.transaction,
    minimalRecord: params.minimalRecord
  })
  
  await runHooks('checkPermissions');
}