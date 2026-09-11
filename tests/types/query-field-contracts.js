// @ts-check
import { buildQueryFieldRuntimes, compileQueryFields } from '../../plugins/core/lib/querying-writing/query-field-helpers.js'
/** @import { StorageDatabase } from '../../plugins/core/lib/storage/storage-types.js' */

/** @param {StorageDatabase} db */
export async function checkProjectionContracts (db) {
  const scope = { scopeName: 'items', idProperty: 'id', schemaStructure: {}, computed: {}, schemaRelationships: {} }
  const queryFields = compileQueryFields({
    total: { type: 'number', select: ({ column }) => db.raw('?? + ?', [column('amount'), 1]) },
    name: { type: 'string', select: ({ ref }) => db.raw('?', [ref('title')]) },
    nested: { type: 'number', select: () => db('items').count('*') },
    literal: { type: 'number', select: () => db.raw('?', [1]) }
  }, scope)
  const result = await buildQueryFieldRuntimes({ db, queryFields, queryFieldNames: ['total'] })
  result.get('total')?.sql.toUpperCase()
  // @ts-expect-error Compilation needs the final namespace, not just its name.
  compileQueryFields({}, { scopeName: 'items' })
  // @ts-expect-error Projection callbacks return SQL expressions, not literal values.
  compileQueryFields({ invalid: { type: 'number', select: () => 42 } }, scope)
  // @ts-expect-error Awaiting a builder executes it and returns rows rather than an expression.
  compileQueryFields({ invalid: { type: 'number', select: async () => db('items') } }, scope)
  // @ts-expect-error Raw expressions are also thenable and async return assimilates them.
  compileQueryFields({ invalid: { type: 'number', select: async () => db.raw('1') } }, scope)
  // @ts-expect-error The callback's database is optional; callers must establish it exists.
  compileQueryFields({ invalid: { type: 'number', select: ({ db }) => db.raw('1') } }, scope)
  // @ts-expect-error A runtime request needs compiled fields with a selected callback.
  buildQueryFieldRuntimes({ queryFields: { missing: { type: 'string' } } })
  // @ts-expect-error Field names are strings.
  buildQueryFieldRuntimes({ queryFieldNames: [1] })
  // @ts-expect-error Bound driver values have not been established as strings.
  result.get('total')?.bindings[0].toUpperCase()
}
