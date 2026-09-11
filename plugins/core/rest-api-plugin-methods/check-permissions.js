// Run the resource permission hook with the originating operation context.
export default async function checkPermissionsMethod ({ context, params, runHooks }) {
  Object.assign(context, {
    method: params.method,
    originalContext: params.originalContext,
  })

  await runHooks('checkPermissions')
}
