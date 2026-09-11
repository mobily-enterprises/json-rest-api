// @ts-check
/** @import { OrdinaryDataReadHelpers, CanonicalDataReadHelpers, DataReadContext } from '../../plugins/core/lib/storage/storage-types.js' */

/**
 * @param {OrdinaryDataReadHelpers} ordinary
 * @param {CanonicalDataReadHelpers} canonical
 * @param {DataReadContext} context
 */
export async function checkDataReadContracts (ordinary, canonical, context) {
  const request = { scopeName: 'items', context }
  const singleRequest = { ...request, context: { ...context, id: 'item-1' } }
  const single = await ordinary.dataGetMinimal(singleRequest)
  if (single) single.id.toUpperCase()
  const batch = await ordinary.dataGetMinimal({ ...request, ids: [] })
  batch.map(record => record.id)
  const canonicalBatch = await canonical.dataGetMinimal({ ...request, ids: ['item-1'] })
  canonicalBatch.map(record => record.type)
  // @ts-expect-error A batched minimal read returns resources, not a document.
  const invalidBatchDocument = batch.data
  // @ts-expect-error A single minimal read is not an array.
  single?.map(() => 'id')
  // @ts-expect-error A single minimal read requires its logical ID.
  await ordinary.dataGetMinimal(request)
  // @ts-expect-error Canonical full reads can return null when the row is absent.
  const invalidCanonicalId = (await canonical.dataGet(singleRequest)).data.id
  const document = await ordinary.dataQuery({
    ...request,
    context: { ...context, queryParams: {}, returnMeta: {} }
  })
  document.data.map(record => record.id)
  // @ts-expect-error Storage attributes have not been normalized to final JSON scalars.
  document.data[0]?.attributes?.name.toUpperCase()
  return { single, batch, document, invalidBatchDocument, invalidCanonicalId }
}
