import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDatabase, databaseClient } from './helpers/test-database.js'
import { cleanTables } from './helpers/test-utils.js'
import { addKnexFields, alterKnexFields, createKnexTable, generateKnexMigration, generateKnexMigrationDiff } from '../plugins/core/lib/dbTablesOperations.js'
import { introspectKnexTableSnapshot } from '../plugins/core/lib/dbIntrospection.js'

const tableName = 'precision_records'
const schema = (type, precision) => ({ structure: { atTime: { type, temporalPrecision: precision } } })

describe('Schema migration capability preflight', () => {
  it('requires an explicit MySQL target before emitting native SET migration code', () => {
    const definition = { structure: { flags: { type: 'string', setValues: ['featured'] } } }
    assert.throws(() => generateKnexMigration(tableName, definition), /flags.*explicit.*dialect/)
    assert.equal(typeof generateKnexMigration(tableName, definition, { dialect: 'mysql2' }), 'string')
  })
  for (const dialect of ['pg', 'postgresql', 'mysql', 'mysql2']) {
    for (const type of ['time', 'dateTime']) {
      it(`rejects ${dialect} ${type} precision 7 before emitting migration code`, () => {
        assert.throws(() => generateKnexMigration(tableName, schema(type, 7), { dialect }), /atTime.*temporalPrecision.*6/)
        assert.throws(() => generateKnexMigrationDiff(tableName, { dialect, columns: [] }, schema(type, 7)), /atTime.*temporalPrecision.*6/)
      })
    }
  }
  for (const type of ['time', 'dateTime']) {
    it(`requires a migration dialect for high-precision ${type}`, () => {
      assert.throws(() => generateKnexMigration(tableName, schema(type, 7)), /explicit.*dialect/)
      assert.equal(typeof generateKnexMigration(tableName, schema(type, 7), { dialect: 'better-sqlite3' }), 'string')
    })
  }
})

describe(`Schema DDL preflight (${databaseClient})`, () => {
  let database, db
  before(async () => {
    database = await createTestDatabase()
    db = database.knex
  })
  beforeEach(async () => {
    await db.schema.dropTableIfExists('precision_new')
    await db.schema.dropTableIfExists(tableName)
    await createKnexTable(db, { tableName }, { structure: { name: { type: 'string' }, atTime: { type: 'time', temporalPrecision: 3 } } })
    await cleanTables(db, [tableName], { storage: 'knex' })
    await db(tableName).insert({ name: 'Original', at_time: '12:34:56.123' })
  })
  after(async () => { await database?.close() })

  if (databaseClient !== 'mysql2') {
    for (const operation of ['create', 'add', 'alter']) {
      it(`rejects native SET ${operation} before any SQL`, async () => {
        const initial = await introspectKnexTableSnapshot(db, { tableName })
        const rows = await db(tableName).select('*')
        const queries = []
        const observe = query => queries.push(query.sql)
        const fields = { name: { type: 'string', setValues: ['featured'] } }
        db.on('query', observe)
        try {
          const action = operation === 'create'
            ? () => createKnexTable(db, { tableName: 'precision_new' }, { structure: fields })
            : operation === 'add'
              ? () => addKnexFields(db, tableName, { structure: { extra: fields.name } })
              : () => alterKnexFields(db, tableName, { structure: fields })
          await assert.rejects(action(), /setValues.*MySQL-compatible/)
        } finally { db.off('query', observe) }
        assert.deepEqual(queries, [])
        assert.deepEqual(await introspectKnexTableSnapshot(db, { tableName }), initial)
        assert.deepEqual(await db(tableName).select('*'), rows)
        assert.equal(await db.schema.hasTable('precision_new'), false)
      })
    }
  }

  for (const type of ['time', 'dateTime']) {
    it(`accepts zero fractional digits for ${type}`, async () => {
      await createKnexTable(db, { tableName: 'precision_new' }, schema(type, 0))
      const result = await introspectKnexTableSnapshot(db, { tableName: 'precision_new' })
      assert.equal(result.columns.some(column => column.name === 'at_time'), true)
      if (databaseClient !== 'better-sqlite3') assert.equal(result.columns.find(column => column.name === 'at_time').datetimePrecision, 0)
    })
  }

  const cases = databaseClient === 'better-sqlite3' ? [-1, 1.5, '6'] : [-1, 1.5, '6', 7]
  for (const precision of cases) {
    for (const type of ['time', 'dateTime']) {
      for (const operation of ['create', 'add', 'alter']) {
        it(`rejects ${operation} ${type} precision ${JSON.stringify(precision)} before any SQL`, async () => {
          const initial = await introspectKnexTableSnapshot(db, { tableName })
          const rows = await db(tableName).select('*')
          const queries = []
          const observe = query => queries.push(query.sql)
          db.on('query', observe)
          try {
            const fields = { name: { type: 'string', defaultTo: 'Changed' }, atTime: { type, temporalPrecision: precision } }
            // Runtime helpers must use the actual client, not an override for generated SQL.
            const options = { dialect: 'better-sqlite3' }
            const action = operation === 'create'
              ? () => createKnexTable(db, { tableName: 'precision_new' }, { structure: fields }, options)
              : operation === 'add'
                ? () => addKnexFields(db, tableName, { structure: { extra: fields.name, extraTime: fields.atTime } }, options)
                : () => alterKnexFields(db, tableName, { structure: fields }, options)
            await assert.rejects(action(), /temporalPrecision/)
          } finally { db.off('query', observe) }
          assert.deepEqual(queries, [])
          assert.deepEqual(await introspectKnexTableSnapshot(db, { tableName }), initial)
          assert.deepEqual(await db(tableName).select('*'), rows)
          assert.equal(await db.schema.hasTable('precision_new'), false)
        })
      }
    }
  }
})
