// @ts-check
/** @import { OrdinaryDataWriteHelpers, CanonicalDataWriteHelpers, DataWriteContext, DataIdentityContext } from '../../plugins/core/lib/storage/storage-types.js' */

/**
 * @param {OrdinaryDataWriteHelpers} ordinary
 * @param {CanonicalDataWriteHelpers} canonical
 * @param {DataWriteContext & DataIdentityContext} context
 */
export async function checkDataWriteContracts (ordinary, canonical, context) {
  const request = { scopeName: 'items', context }
  const exists = await ordinary.dataExists(request)
  const boolean = /** @satisfies {boolean} */ (exists)
  const deletion = await ordinary.dataDelete(request)
  const success = /** @satisfies {true} */ (deletion.success)
  const count = await canonical.dataDelete(request)
  count.toFixed()
  const replacement = { ...request, context: { ...context, isCreate: false } }
  await ordinary.dataPut(replacement)
  ;(await canonical.dataPut(replacement)).toFixed()
  // @ts-expect-error PUT must explicitly select create or replace.
  await ordinary.dataPut(request)
  // @ts-expect-error Ordinary PATCH returns no affected-row count.
  ;(await ordinary.dataPatch(request)).toFixed()
  // @ts-expect-error Canonical DELETE is a count, not the ordinary success object.
  const invalidSuccess = (await canonical.dataDelete(request)).success
  // @ts-expect-error POST's raw insert result cannot be assumed to be a string.
  ;(await ordinary.dataPost(request)).trim()
  // @ts-expect-error Data helpers require an executable DB handle.
  await canonical.dataExists({ ...request, context: { ...context, db: {} } })
  return { boolean, success, invalidSuccess }
}
