import { it } from 'node:test'
import assert from 'node:assert/strict'
import knex from 'knex'
import { buildQueryFieldRuntimes, compileQueryFields } from '../plugins/core/lib/querying-writing/query-field-helpers.js'

it('retains builders and raw expressions without executing them', async () => {
  const db = knex({ client: 'sqlite3', useNullAsDefault: true })
  try {
    let queries = 0
    db.on('query', () => { queries++ })
    const builder = db('uncreated_items').select('amount')
    const wrapped = new Proxy(builder, { has: () => { throw new Error('Expression inspection must not add property-presence probes') } })
    const fields = compileQueryFields({
      nested: { type: 'number', select: () => wrapped },
      literal: { type: 'number', select: ({ column }) => db.raw('?? + ?', [column('amount'), 2]) }
    }, { scopeName: 'items', idProperty: 'id', schemaStructure: {}, computed: {}, schemaRelationships: {} })
    const runtimes = await buildQueryFieldRuntimes({ db, queryFields: fields, queryFieldNames: ['nested', 'literal', 'nested'], tableName: 'items' })
    assert.equal(queries, 0)
    assert.equal(runtimes.size, 2)
    assert.equal(runtimes.get('nested').expression, wrapped)
    assert.match(runtimes.get('nested').sql, /select.*amount.*uncreated_items/i)
    assert.deepEqual(runtimes.get('literal').bindings, [2])
    assert.match(runtimes.get('literal').sql, /items.*amount/)
  } finally { await db.destroy() }
})
