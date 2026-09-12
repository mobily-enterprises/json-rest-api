import type { ManagedTransaction } from '../../types/transactions.js'
import type { BulkResourceMethods } from '../../types/bulk-methods.js'
declare const transaction: ManagedTransaction
declare const items: BulkResourceMethods<{ name: string; revision: string }, { name: string }, 'items'>
declare const nonAtomicItems: BulkResourceMethods<{ name: string }, { name: string }, 'items', 'plain', 'full', false>

const created = await items.bulkPost({ format: 'jsonapi', document: { data: [
  { type: 'items', attributes: { name: 'First' } },
  { type: 'items', attributes: { name: 'Second' } }
] } })
const name: string | undefined = created.data[0]?.attributes?.name
const minimal = await items.bulkPatch({
  operations: [{ id: 1, data: { name: 'Changed' } }],
  expectedVersions: ['token'], returning: 'minimal', transaction
})
const id: string | undefined = minimal.data[0]?.id
const none = await items.bulkPatch({ operations: [{ id: 1, data: { name: 'Changed' } }], returning: 'none' })
const succeeded: number = none.meta.succeeded
const deleted = await items.bulkDelete({ ids: [1, '2'], atomic: false, expectedVersions: ['first', 'second'] })
const deletedIds: Array<string | number | bigint> = deleted.meta.deleted
await nonAtomicItems.bulkDelete({ ids: [1], transaction, atomic: true })
const jsonPlain = await items.bulkPost({ data: [{ name: 'New' }], format: 'jsonapi' })
const jsonName: string | undefined = jsonPlain.data[0]?.attributes?.name
const plainDocument = await items.bulkPost({ document: { data: [{ type: 'items', attributes: { name: 'New' } }], meta: { reason: 'Import' } } })
const plainName: string | undefined = plainDocument.data[0]?.name
await items.bulkPatch({ operations: [
  { id: 1, data: { name: 'Plain' } },
  { id: 2, document: { data: { type: 'items', attributes: { name: 'Document' } } } }
] })
void [name, id, succeeded, deletedIds, jsonName, plainName]

// @ts-expect-error Bulk creation cannot have version conditions.
await items.bulkPost({ data: [{ name: 'New' }], expectedVersions: ['token'] })
// @ts-expect-error Singular version conditions cannot guard a batch.
await items.bulkDelete({ ids: [1], expectedVersion: 'token' })
// @ts-expect-error Non-atomic batches cannot borrow caller transactions.
await items.bulkDelete({ ids: [1], atomic: false, transaction })
// @ts-expect-error Configured non-atomic defaults require an explicit atomic override.
await nonAtomicItems.bulkDelete({ ids: [1], transaction })
// @ts-expect-error Bulk PATCH data is ordinary field values regardless of output format.
await items.bulkPatch({ format: 'jsonapi', operations: [{ id: 1, data: { data: { type: 'items' } } }] })
// @ts-expect-error Bulk POST requires data or document, not the removed inputRecords.
await items.bulkPost({ inputRecords: [{ name: 'Old' }] })
// @ts-expect-error Both bulk POST input keys are ambiguous.
await items.bulkPost({ data: [{ name: 'New' }], document: { data: [{ type: 'items' }] } })
// @ts-expect-error Both operation input keys are ambiguous.
await items.bulkPatch({ operations: [{ id: 1, data: { name: 'New' }, document: { data: { type: 'items' } } }] })
// @ts-expect-error Bulk POST document data contains resources, not nested documents.
await items.bulkPost({ document: { data: [{ data: { type: 'items' } }] } })
// @ts-expect-error Bulk POST does not interpret included resources as nested writes.
await items.bulkPost({ document: { data: [{ type: 'items' }], included: [] } })
// @ts-expect-error No-return bulk writes omit data while retaining metadata.
none.data.length
// @ts-expect-error JSON:API bulk results contain resources, not nested documents.
created.data[0]?.data
// @ts-expect-error Conditions are arrays of string revisions.
await items.bulkDelete({ ids: [1], expectedVersions: [42] })
