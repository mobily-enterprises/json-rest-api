import type { Knex } from 'knex'
import type { TransactionMethods } from '../../types/transactions.js'
import type { ResourceCoreMethods } from '../../types/resource-methods.js'
import type { RelationshipMethods } from '../../types/relationship-methods.js'
import type { BulkResourceMethods } from '../../types/bulk-methods.js'

declare const api: TransactionMethods
declare const items: ResourceCoreMethods<{ name: string }>
declare const relationships: RelationshipMethods
declare const bulk: BulkResourceMethods
declare const raw: Knex.Transaction

await items.get({ id: '1', transaction: raw })
await relationships.getRelationship({ id: '1', relationshipName: 'children', transaction: raw })
const result: number = await api.transaction(async transaction => {
  await items.patch({ id: '1', inputRecord: { name: 'Changed' }, transaction })
  await relationships.patchRelationship({ id: '1', relationshipName: 'children', relationshipData: [], transaction })
  await bulk.bulkDelete({ ids: ['2'], transaction, atomic: true })
  await transaction('audit_entries').insert({ message: 'Changed' })
  return 42
})
const synchronous: string = await api.transaction(() => 'result')
void [result, synchronous]

// @ts-expect-error Raw Knex transactions cannot own library writes.
await items.patch({ id: '1', inputRecord: { name: 'Changed' }, transaction: raw })
// @ts-expect-error The same ownership rule applies to deletion.
await items.delete({ id: '1', transaction: raw })
// @ts-expect-error Relationship writes also require a managed owner.
await relationships.postRelationship({ id: '1', relationshipName: 'children', relationshipData: [], transaction: raw })
// @ts-expect-error Atomic bulk work cannot borrow an unmanaged transaction.
await bulk.bulkDelete({ ids: ['1'], atomic: true, transaction: raw })
await api.transaction(async transaction => {
  // @ts-expect-error Completion belongs to the library.
  await transaction.commit()
  // @ts-expect-error Throw from the callback to roll back.
  await transaction.rollback()
  // @ts-expect-error Child savepoints are not supported for managed writes.
  await transaction.savepoint()
})
// @ts-expect-error The transaction method takes a callback, not an options object.
await api.transaction({ callback: () => 42 })
