import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDatabase } from './helpers/test-database.js'
import { createKnexTable, addKnexFields, alterKnexFields, generateKnexMigration, generateKnexMigrationDiff } from '../plugins/core/lib/dbTablesOperations.js'
import { introspectKnexTableSnapshot } from '../plugins/core/lib/dbIntrospection.js'
const fields = { structure: { type: 'string', nullable: true }, title: { type: 'string' } }
describe('Explicit table-schema input', () => {
  let database, db, snapshot
  before(async () => {
    database = await createTestDatabase()
    db = database.knex
    await createKnexTable(db, { tableName: 'existing' }, { structure: fields })
    snapshot = await introspectKnexTableSnapshot(db, { tableName: 'existing' })
  })
  after(async () => { await database?.close() })
  it('generates only the declared columns for an explicit structure wrapper', () => {
    const migration = generateKnexMigration('items', { structure: fields })
    assert.match(migration, /string\('structure'\)/)
    assert.match(migration, /string\('title'\)/)
    assert.doesNotMatch(migration, /string\('(?:type|nullable)'\)/)
  })
  for (const operation of ['create', 'add', 'alter', 'generate', 'diff']) {
    it(`rejects an ambiguous bare map before SQL for ${operation}`, async () => {
      const queries = []
      const observe = query => queries.push(query.sql)
      db.on('query', observe)
      try {
        await assert.rejects(async () => {
          if (operation === 'create') await createKnexTable(db, { tableName: 'unexpected' }, fields)
          if (operation === 'add') await addKnexFields(db, 'existing', fields)
          if (operation === 'alter') await alterKnexFields(db, 'existing', fields)
          if (operation === 'generate') generateKnexMigration('existing', fields)
          if (operation === 'diff') generateKnexMigrationDiff('existing', snapshot, fields)
        }, /Wrap bare field maps/)
      } finally { db.off('query', observe) }
      assert.deepEqual(queries, [])
    })
  }
  for (const invalid of [null, { title: { type: 'string' } }, { structure: [] }, { structure: { title: null } }]) {
    it(`rejects an invalid schema shape ${JSON.stringify(invalid)}`, async () => {
      const queries = []
      const observe = query => queries.push(query.sql)
      db.on('query', observe)
      try {
        for (const operation of [
          () => createKnexTable(db, { tableName: 'unexpected' }, invalid),
          () => addKnexFields(db, 'existing', invalid),
          () => alterKnexFields(db, 'existing', invalid),
          () => generateKnexMigration('existing', invalid),
          () => generateKnexMigrationDiff('existing', snapshot, invalid)
        ]) await assert.rejects(async () => operation(), /structure field map|object definition/)
      } finally { db.off('query', observe) }
      assert.deepEqual(queries, [])
    })
  }
})
