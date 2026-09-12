// @ts-check
import { createStorageAdapter, createSelectTranslator } from '../../plugins/core/lib/storage/storage-adapter.js'
import { createStorageAdapterUtilities } from '../../plugins/core/lib/querying/storage-adapter-utils.js'
import { getCanonicalFieldValue, translateCanonicalRecordFromStorage } from '../../plugins/core/lib/storage/canonical-storage-mapping.js'
import { translateAttributesForStorage, translateRecordFromStorage } from '../../plugins/core/lib/storage/storage-mapping.js'

/** @import { StorageAdapter, StorageDatabase, StorageRow, StorageSchemaInfo } from '../../plugins/core/lib/storage/storage-types.js' */

// Compiled by tsc; never executed or connected to a database.
/** @param {StorageDatabase} knex */
export function checkStorageAdapterContracts (knex) {
  /** @type {StorageSchemaInfo} */
  const schemaInfo = { tableName: 'books', schemaStructure: { title: { type: 'string', storage: { column: 'book_title' } } } }
  const adapter = createStorageAdapter({ knex, schemaInfo })
  const id = adapter.translateFilterValue('id', '1')
  if (typeof id !== 'string' && typeof id !== 'number') throw new TypeError('Expected a scalar resource ID')
  const query = adapter.buildBaseQuery({ transaction: knex })
    .where(adapter.getIdColumn(), id)
  const select = createSelectTranslator(adapter)
  adapter.buildBaseQuery({ tableAlias: 'joined books', transaction: knex })
  adapter.selectColumns(query, [select('id'), select('title', 'books')])
  adapter.selectColumns(query, { result: adapter.translateColumn('title') })
  const cursor = adapter.translateCursorValue('title', 'Value')
  if (typeof cursor !== 'string') throw new TypeError('Expected a text cursor')
  adapter.applyResourceScope(query.clone()).where(adapter.translateColumn('title'), cursor)
  const utilities = createStorageAdapterUtilities({ context: { knexQuery: { scopeName: 'books', tableName: 'b', storageAdapter: adapter } } }, { getStorageAdapter: () => adapter })
  utilities.translateColumn('books', 'title')
  utilities.translateFilterValue('books', 'title', ['a', null])

  /** @type {StorageRow} */
  const row = adapter.toStorageRow({ title: 'Value' }, { context: { scopeName: 'books' }, operation: 'patch' })
  const title = adapter.getFieldValue(row, 'title')
  if (typeof title === 'string') title.toUpperCase()
  translateAttributesForStorage(row, schemaInfo)
  const logicalTitle = translateRecordFromStorage(row, schemaInfo).title
  translateRecordFromStorage(null, schemaInfo)
  const canonicalAttributes = translateCanonicalRecordFromStorage({ logical_id: '1' }, {}).attributes
  getCanonicalFieldValue(null, {}, 'id')
  createSelectTranslator(null)

  // @ts-expect-error A logical column name is a string.
  adapter.translateColumn(42)
  // @ts-expect-error Table aliases must be identifier strings.
  adapter.buildBaseQuery({ tableAlias: 42 })
  // @ts-expect-error The existing adapter has no generic query-execution method.
  adapter.runQuery({})
  // @ts-expect-error Transactions must be resolved database handles.
  adapter.buildBaseQuery({ transaction: Promise.resolve(knex) })
  // @ts-expect-error A commit function alone is not a database handle.
  adapter.buildBaseQuery({ transaction: { commit: () => Promise.resolve() } })
  // @ts-expect-error Transaction ownership is not a buildBaseQuery option.
  adapter.buildBaseQuery({ commit: true })
  // @ts-expect-error Selections use arrays or alias maps; a bare string is not handled here.
  adapter.selectColumns(query, 'title')
  // @ts-expect-error Stored attributes are a field/value object.
  adapter.toStorageRow(['title'])
  // @ts-expect-error Driver/serializer values require narrowing before string operations.
  adapter.getFieldValue(row, 'title').trim()
  // @ts-expect-error A column translator cannot return a number.
  const invalidAdapter = /** @satisfies {StorageAdapter} */ ({ ...adapter, translateColumn: () => 42 })
  // @ts-expect-error Schema fields must carry definitions.
  createStorageAdapter({ knex, schemaInfo: { tableName: 'books', schemaStructure: { title: 'string' } } })
  // @ts-expect-error Canonical descriptors must identify both physical tenant and resource.
  createStorageAdapter({ knex, schemaInfo: { ...schemaInfo, descriptor: { canonical: { tableName: 'records', tenantColumn: 'tenant_id', resourceColumn: 'resource' } } } })
  // @ts-expect-error The adapter never exposes transaction completion.
  adapter.commit()

  return { query, row, logicalTitle, canonicalAttributes, invalidAdapter }
}
