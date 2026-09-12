// @ts-check
import { createOrdinaryDataHelpers } from '../../plugins/core/lib/storage/ordinary-data-helpers.js'
import { createCanonicalDataHelpers } from '../../plugins/core/lib/storage/canonical-data-helpers.js'
/** @import { OrdinaryDataDependencies, CanonicalDataDependencies, DataReadContext, StorageFieldDefinition, StorageAdapter } from '../../plugins/core/lib/storage/storage-types.js' */

/** @param {OrdinaryDataDependencies} ordinaryDependencies @param {CanonicalDataDependencies} canonicalDependencies @param {DataReadContext} context */
export async function checkStorageImplementations (ordinaryDependencies, canonicalDependencies, context) {
  const ordinary = createOrdinaryDataHelpers(ordinaryDependencies)
  const canonical = createCanonicalDataHelpers(canonicalDependencies)
  const request = { scopeName: 'items', context }
  const ordinaryBatch = await ordinary.dataGetMinimal({ ...request, ids: [] })
  const canonicalBatch = await canonical.dataGetMinimal({ ...request, ids: [] })
  ordinaryBatch.map(record => record.id.toUpperCase())
  canonicalBatch.map(record => record.type)
  const single = await canonical.dataGetMinimal({ ...request, context: { ...context, id: '1' } })
  if (single) single.id.toUpperCase()
  // @ts-expect-error Implementations preserve the single/batch distinction.
  const invalidBatchDocument = ordinaryBatch.data
  // @ts-expect-error A single minimal lookup requires an identity.
  await ordinary.dataGetMinimal(request)
  // @ts-expect-error Executed rows cannot replace the wrapped filtering builder.
  await ordinary.dataGetMinimal({ ...request, ids: [], applyQueryFilters: async () => [{ id: '1' }] })
  await ordinary.dataGetMinimal({ ...request, ids: [], applyQueryFilters: async () => ({ query: context.db('items') }) })
  // @ts-expect-error Ordinary collection reads must execute their filtering hooks.
  await ordinary.dataQuery({ ...request, context: { ...context, queryParams: {} } })
  return invalidBatchDocument
}

/** @param {StorageFieldDefinition} field @param {StorageAdapter} adapter */
export function checkUnvalidatedSerializerValues (field, adapter) {
  const serialize = field.storage?.serialize
  if (serialize) {
    const serialized = serialize('value', { definition: field })
    // @ts-expect-error SQL driver validation is still authoritative for serializer results.
    serialized.toUpperCase()
  }
  const filterValue = adapter.translateFilterValue('id', 'value')
  // @ts-expect-error Translation does not promise string output for custom serializers.
  filterValue.toUpperCase()
}
