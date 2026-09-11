import { it } from 'node:test'
import assert from 'node:assert/strict'
import knex from 'knex'
import { buildQuerySelection } from '../plugins/core/lib/querying/knex-query-helpers-base.js'

for (const client of ['sqlite3', 'pg', 'mysql2']) {
  for (const mapping of [false, true]) {
    it(`${client} preserves SQL bindings when aliasing a ${mapping ? 'mapped' : 'raw'} translated expression`, async () => {
      const db = knex({ client, useNullAsDefault: true })
      try {
        const expression = db.raw('?? + ?', ['items.amount', 7])
        const query = buildQuerySelection(db('items'), 'items', ['amount as total'], true, {
          translateColumn: () => mapping ? { amount: expression } : expression
        })
        assert.equal(query.toSQL().sql, 'select `items`.`amount` + ? as `total` from `items`'.replaceAll('`', client === 'pg' ? '"' : '`'))
        assert.deepEqual(query.toSQL().bindings, [7])
      } finally { await db.destroy() }
    })
  }
}

for (const mapping of [{}, { first: 'name', second: 'amount' }]) {
  it(`rejects a single alias applied to ${Object.keys(mapping).length} translated expressions`, async () => {
    const db = knex({ client: 'sqlite3', useNullAsDefault: true })
    try {
      assert.throws(() => buildQuerySelection(db('items'), 'items', ['amount as total'], true, {
        translateColumn: () => mapping
      }), /Cannot apply alias 'total'.*multiple or missing expressions/)
    } finally { await db.destroy() }
  })
}

it('preserves wildcard fallback, translated expressions and explicit aliases without execution', async () => {
  const db = knex({ client: 'sqlite3', useNullAsDefault: true })
  try {
    let executions = 0
    db.on('query', () => { executions++ })
    const wildcard = db('items')
    assert.equal(buildQuerySelection(wildcard, 'items', '*', false, { translateColumn: () => undefined }), wildcard)
    assert.equal(wildcard.toSQL().sql, 'select * from `items`')
    const calls = []
    const query = db('items')
    const selected = buildQuerySelection(query, 'items', Object.freeze(['name as title', 'literal', 'mapped']), true, {
      translateColumn: (field, alias) => {
        calls.push([field, alias])
        if (field === 'name') return `${alias}.stored_name`
        if (field === 'literal') return db.raw('? as literal', [7])
        return { mapped: db.raw('?', [8]) }
      }
    })
    assert.equal(selected, query)
    assert.deepEqual(calls, [['name', 'items'], ['literal', 'items'], ['mapped', 'items']])
    assert.equal(selected.toSQL().sql, 'select `items`.`stored_name` as `title`, ? as literal, ? as `mapped` from `items`')
    assert.deepEqual(selected.toSQL().bindings, [7, 8])
    const aliases = []
    buildQuerySelection(db('items'), 'items', ['name'], false, { translateColumn: (field, alias) => { aliases.push(alias); return null } })
    assert.deepEqual(aliases, [null])
    assert.equal(executions, 0)
  } finally { await db.destroy() }
})
