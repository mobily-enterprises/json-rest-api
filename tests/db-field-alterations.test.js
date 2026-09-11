import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDatabase, databaseClient } from './helpers/test-database.js'
import { createRegularSchemaApi } from './fixtures/api-configs.js'
import { cleanTables } from './helpers/test-utils.js'
import { abortTransactionBeforeCommit, interceptTransactionCompletion } from './helpers/transaction-completion.js'
import { alterKnexFields, generateKnexMigrationDiff } from '../plugins/core/lib/dbTablesOperations.js'

const tableName = 'schema_records'
const role = { type: 'string', enum: ['Owner', "O'Brien", 'Member'], required: true, defaultTo: 'Member' }

describe(`Direct field alterations (${databaseClient}, regular storage)`, () => {
  let database, db, items
  before(async () => {
    database = await createTestDatabase(undefined, { concurrent: true, maxConnections: 1 })
    db = database.knex
    const api = await createRegularSchemaApi(db, {
      schema: {
        id: { type: 'id' },
        role,
        optionalNote: { type: 'string', nullable: true },
        observedAt: { type: 'dateTime', temporalPrecision: 3 },
        atTime: { type: 'time', temporalPrecision: 3 }
      }
    })
    items = api.resources.items
  })
  after(async () => database?.close())
  beforeEach(async () => {
    await db.schema.dropTableIfExists('schema_children')
    await db.schema.dropTableIfExists(tableName)
    await items.createKnexTable()
    await cleanTables(db, [tableName], { storage: 'knex' })
    await db(tableName).insert({ optional_note: null })
  })
  const snapshot = () => items.introspectKnexTableSnapshot()

  it('changes an enum default without duplicating checks or losing values', async () => {
    await items.alterKnexFields({ fields: { role: { ...role, defaultTo: 'Owner' } } })
    await db(tableName).insert({ record_key: 2 })
    await db(tableName).insert({ record_key: 3, role: "O'Brien" })
    assert.deepEqual((await db(tableName).orderBy('record_key')).map(row => row.role), ['Member', 'Owner', "O'Brien"])
    await assert.rejects(db(tableName).insert({ role: 'Invalid' }))
    if (databaseClient !== 'mysql2') assert.equal((await snapshot()).checkConstraints.length, 1)
  })

  it('preserves SQL-sensitive defaults in field additions and direct alterations', async () => {
    const text = "Path\\? O'Brien"
    await items.addKnexFields({ fields: { config: { type: 'object', defaultTo: { value: text } } } })
    await items.alterKnexFields({ fields: { optionalNote: { type: 'string', defaultTo: text } } })
    await db(tableName).insert({ record_key: 2 })
    const row = await db(tableName).where({ record_key: 2 }).first()
    assert.equal(row.optional_note, text)
    assert.deepEqual(typeof row.config === 'string' ? JSON.parse(row.config) : row.config, { value: text })
  })

  for (const change of ['replace', 'remove', 'add']) {
    it(`${change}s enum values or rejects a required SQLite rebuild before any changes`, async () => {
      const target = change === 'add' ? 'optionalNote' : 'role'
      const definition = change === 'remove'
        ? { type: 'string', required: true, defaultTo: 'Member' }
        : { type: 'string', enum: ["O'Brien", 'Member', 'Admin'], defaultTo: 'Member' }
      const initial = await snapshot()
      const operation = () => items.alterKnexFields({
        fields: {
          observedAt: { type: 'dateTime', temporalPrecision: 6, defaultTo: '2024-02-29 01:02:03' },
          [target]: definition
        }
      })
      if (databaseClient === 'better-sqlite3') {
        await assert.rejects(operation, /SQLite.*table rebuild/)
        assert.deepEqual(await snapshot(), initial)
      } else {
        await operation()
        const column = change === 'add' ? 'optional_note' : 'role'
        const value = change === 'remove' ? 'Free' : 'Admin'
        await db(tableName).insert({ [column]: value })
        assert.equal((await db(tableName).where('record_key', '>', 1).first())[column], value)
        if (change !== 'remove') await assert.rejects(db(tableName).insert({ [column]: 'Invalid' }))
        assert.equal((await db(tableName).where({ record_key: 1 }).first()).role, 'Member')
      }
    })
  }

  it('preserves all column definitions and data after an incompatible enum change', async () => {
    await db(tableName).where({ record_key: 1 }).update({ role: 'Owner' })
    const initial = await snapshot()
    await assert.rejects(items.alterKnexFields({ fields: { role: { ...role, enum: ['Admin', 'Member'], defaultTo: 'Admin' } } }))
    assert.deepEqual(await snapshot(), initial)
    assert.equal((await db(tableName).first()).role, 'Owner')
    await assert.rejects(db(tableName).insert({ role: 'Admin' }))
  })

  it('rolls back earlier column changes when a later not-null alteration fails', async () => {
    const initial = await snapshot()
    await assert.rejects(items.alterKnexFields({
      fields: {
        role: { ...role, defaultTo: 'Owner' },
        optionalNote: { type: 'string', required: true }
      }
    }))
    assert.deepEqual(await snapshot(), initial)
    await db(tableName).insert({ record_key: 2 })
    assert.deepEqual((await db(tableName).orderBy('record_key')).map(row => row.role), ['Member', 'Member'])
  })

  it('rejects missing columns without leaving earlier alterations applied', async () => {
    const initial = await snapshot()
    await assert.rejects(items.alterKnexFields({
      fields: {
        role: { ...role, defaultTo: 'Owner' },
        missing: { type: 'string' }
      }
    }))
    assert.deepEqual(await snapshot(), initial)
  })

  it('preserves ownership when supplied an existing transaction', async () => {
    const initial = await snapshot()
    const abort = new Error('Owner rollback')
    if (databaseClient === 'better-sqlite3') await db.raw('PRAGMA foreign_keys = OFF')
    try {
      await assert.rejects(db.transaction(async trx => {
        await trx(tableName).insert({ record_key: 2 })
        const operation = () => alterKnexFields(trx, tableName, { structure: { role: { ...role, defaultTo: 'Owner' } } })
        if (databaseClient === 'mysql2') await assert.rejects(operation, /MySQL.*transaction/)
        else {
          await operation()
          await trx(tableName).insert({ record_key: 3 })
          assert.equal((await trx(tableName).where({ record_key: 3 }).first()).role, 'Owner')
        }
        throw abort
      }), error => error === abort)
    } finally {
      if (databaseClient === 'better-sqlite3') await db.raw('PRAGMA foreign_keys = ON')
    }
    assert.deepEqual(await snapshot(), initial)
    assert.equal((await db(tableName)).length, 1)
  })

  if (databaseClient !== 'mysql2') {
    it('isolates a failed alteration from the owning transaction with a savepoint', async () => {
      const initial = await snapshot()
      if (databaseClient === 'better-sqlite3') await db.raw('PRAGMA foreign_keys = OFF')
      try {
        await db.transaction(async trx => {
          await assert.rejects(alterKnexFields(trx, tableName, {
            structure: {
              role: { ...role, defaultTo: 'Owner' },
              optionalNote: { type: 'string', required: true }
            }
          }), /not.null/i)
          await trx(tableName).where({ record_key: 1 }).update({ optional_note: 'Owner can continue' })
        })
      } finally {
        if (databaseClient === 'better-sqlite3') await db.raw('PRAGMA foreign_keys = ON')
      }
      assert.deepEqual(await snapshot(), initial)
      assert.equal((await db(tableName).first()).optional_note, 'Owner can continue')
    })
  }

  if (databaseClient === 'better-sqlite3') {
    for (const scenario of [
      { label: 'before schema-read COMMIT', target: 1, afterExecution: false },
      { label: 'after schema-read COMMIT', target: 1, afterExecution: true },
      { label: 'before rebuild COMMIT', target: 2, afterExecution: false },
      { label: 'after rebuild COMMIT', target: 2, afterExecution: true },
      { label: 'with failed rollback cleanup', target: 2, cleanup: 'rollback' },
      { label: 'with failed foreign-key restoration', target: 2, cleanup: 'foreignKeys' }
    ]) {
      it(`isolates a SQLite rebuild connection ${scenario.label}`, async t => {
        const originalTransaction = db.client.transaction.bind(db.client)
        const originalQuery = db.client.query
        const cleanupError = new Error('Connection cleanup failed')
        let transactions = 0
        let completion, borrowing, borrowed
        t.mock.method(db.client, 'query', function (connection, statement) {
          const sql = typeof statement === 'string' ? statement : statement.sql
          if (completion?.error && (
            (scenario.cleanup === 'rollback' && /^ROLLBACK\b/i.test(sql)) ||
            (scenario.cleanup === 'foreignKeys' && connection.inTransaction === false && /PRAGMA foreign_keys = ON/i.test(sql))
          )) return Promise.reject(cleanupError)
          return originalQuery.call(this, connection, statement)
        })
        t.mock.method(db.client, 'transaction', (callback, config, outer) => originalTransaction(transaction => {
          if (++transactions === scenario.target) {
            completion = interceptTransactionCompletion(transaction, db, { phase: 'commit', afterExecution: scenario.afterExecution })
            const commit = transaction.commit
            transaction.commit = async (...args) => {
              borrowing = db.client.acquireConnection()
              borrowing.catch(() => {})
              assert.equal(db.client.pool.numPendingAcquires(), 1)
              return commit.apply(transaction, args)
            }
          }
          return callback(transaction)
        }, config, outer))
        try {
          await assert.rejects(items.alterKnexFields({ fields: { role: { ...role, defaultTo: 'Owner' } } }), error => {
            if (scenario.cleanup) {
              assert.ok(error instanceof AggregateError)
              assert.equal(error.cause, completion.error)
              assert.deepEqual(error.errors, [completion.error, cleanupError])
            } else assert.equal(error, completion.error)
            return true
          })
          assert.equal(transactions, scenario.target, 'intercept the selected schema-read or rebuild transaction')
          borrowed = await borrowing
          borrowing = null
          assert.equal(borrowed.inTransaction, false, 'failed rebuild must not lend its unfinished transaction')
          if (scenario.cleanup) assert.notEqual(borrowed, completion.connection)
          await db.client.releaseConnection(borrowed)
          borrowed = null
          t.mock.restoreAll()
          await db(tableName).insert({ record_key: 2 })
          assert.equal((await db(tableName).where({ record_key: 2 }).first()).role, scenario.target === 2 && scenario.afterExecution ? 'Owner' : 'Member')
          assert.equal((await db.raw('PRAGMA foreign_keys'))[0].foreign_keys, 1)
        } finally {
          if (!borrowed && borrowing) borrowed = await borrowing.catch(() => null)
          if (borrowed) await db.client.releaseConnection(borrowed)
          t.mock.restoreAll()
          await completion?.close()
        }
      })
    }
  }

  if (databaseClient === 'pg') {
    it('rejects DDL when PostgreSQL acknowledges COMMIT with ROLLBACK', async t => {
      const originalTransaction = db.transaction.bind(db)
      let completion
      t.mock.method(db, 'transaction', async (...args) => {
        const transaction = await originalTransaction(...args)
        completion = abortTransactionBeforeCommit(transaction)
        return transaction
      })
      try {
        await assert.rejects(items.alterKnexFields({ fields: { role: { ...role, defaultTo: 'Owner' } } }), error => {
          assert.match(error.message, /rolled back instead of committed/i)
          assert.equal(error.transactionOutcome, 'rolledBack')
          return true
        })
        assert.equal(completion.command, 'ROLLBACK')
        assert.equal(completion.rollbacks, 0)
        await db(tableName).insert({ record_key: 2 })
        assert.equal((await db(tableName).where({ record_key: 2 }).first()).role, 'Member')
      } finally { await completion?.close() }
    })

    for (const afterExecution of [false, true]) {
      it(`leaves failed savepoint completion to its caller ${afterExecution ? 'after' : 'before'} RELEASE executes`, async t => {
        let primary, child
        let commits = 0
        let rollbacks = 0
        await assert.rejects(db.transaction(async parent => {
          const originalChild = parent.transaction.bind(parent)
          const commit = parent.commit.bind(parent)
          const rollback = parent.rollback.bind(parent)
          t.mock.method(parent, 'commit', (...args) => { commits++; return commit(...args) })
          t.mock.method(parent, 'rollback', (...args) => { rollbacks++; return rollback(...args) })
          t.mock.method(parent, 'transaction', (callback, config) => originalChild(transaction => {
            child = transaction
            const query = child.client.query
            child.client.query = async function (connection, statement) {
              const sql = typeof statement === 'string' ? statement : statement.sql
              if (!/^RELEASE SAVEPOINT\b/i.test(sql)) return query.call(this, connection, statement)
              try {
                if (!afterExecution) return await query.call(this, connection, 'BROKEN SAVEPOINT COMPLETION;')
                await query.call(this, connection, statement)
                throw new Error('Lost savepoint release acknowledgement')
              } catch (error) { primary = error; throw error }
            }
            return callback(child)
          }, config))
          await assert.rejects(alterKnexFields(parent, tableName, { structure: { role: { ...role, defaultTo: 'Owner' } } }), error => error === primary)
          assert.ok(primary)
          assert.equal(child.parentTransaction, parent)
          assert.equal(child.isCompleted(), true)
          assert.equal(parent.isCompleted(), false)
          assert.equal(commits, 0)
          assert.equal(rollbacks, 0)
          throw primary
        }), error => error === primary)
        assert.equal(commits, 0)
        assert.equal(rollbacks, 1)
        await db(tableName).insert({ record_key: 2 })
        assert.equal((await db(tableName).where({ record_key: 2 }).first()).role, 'Member')
      })
    }

    for (const afterExecution of [false, true]) {
      it(`isolates a DDL connection after COMMIT fails ${afterExecution ? 'after' : 'before'} execution`, async t => {
        const originalTransaction = db.transaction.bind(db)
        let completion, borrowing, borrowed
        const intercept = transaction => {
          completion = interceptTransactionCompletion(transaction, db, { phase: 'commit', afterExecution })
          const commit = transaction.commit
          transaction.commit = async (...args) => {
            borrowing = db.client.acquireConnection()
            borrowing.catch(() => {})
            assert.equal(db.client.pool.numPendingAcquires(), 1)
            return commit.apply(transaction, args)
          }
          return transaction
        }
        t.mock.method(db, 'transaction', (container, config) => {
          if (typeof container === 'function') return originalTransaction(transaction => container(intercept(transaction)), config)
          return originalTransaction(container, config).then(intercept)
        })
        try {
          await assert.rejects(items.alterKnexFields({ fields: { role: { ...role, defaultTo: 'Owner' } } }), error => error.cause === completion.error && error.transactionOutcome === 'unknown')
          borrowed = await borrowing
          borrowing = null
          assert.notEqual(borrowed, completion.connection, 'failed schema completion must not lend an unfinished DDL transaction')
          await db.client.releaseConnection(borrowed)
          borrowed = null
          t.mock.restoreAll()
          await db(tableName).insert({ record_key: 2 })
          assert.equal((await db(tableName).where({ record_key: 2 }).first()).role, afterExecution ? 'Owner' : 'Member')
          await items.alterKnexFields({ fields: { role: { ...role, defaultTo: "O'Brien" } } })
          await db(tableName).insert({ record_key: 3 })
          assert.equal((await db(tableName).where({ record_key: 3 }).first()).role, "O'Brien")
        } finally {
          if (!borrowed && borrowing) borrowed = await borrowing.catch(() => null)
          if (borrowed) await db.client.releaseConnection(borrowed)
          t.mock.restoreAll()
          await completion?.close()
        }
      })
    }
  }

  it('alters ordinary columns on a table with an opaque primary key', async () => {
    await db.schema.dropTable(tableName)
    await db.schema.createTable(tableName, table => {
      table.string('key').primary()
      table.string('label').defaultTo('Old')
    })
    await alterKnexFields(db, tableName, { structure: { label: { type: 'string', defaultTo: 'New' } } })
    await db(tableName).insert({ key: 'opaque' })
    assert.equal((await db(tableName).first()).label, 'New')
  })

  it('alters a table whose physical name contains spaces', async () => {
    const table = 'schema loose'
    try {
      await db.schema.createTable(table, builder => {
        builder.string('key').primary()
        builder.string('label').defaultTo('Old')
      })
      await alterKnexFields(db, table, { structure: { label: { type: 'string', defaultTo: 'New' } } })
      await db(table).insert({ key: 'opaque' })
      assert.equal((await db(table).first()).label, 'New')
    } finally {
      await db.schema.dropTableIfExists(table)
    }
  })

  if (databaseClient !== 'better-sqlite3') {
    it('increases direct datetime/time precision without losing existing values', async () => {
      await db(tableName).where({ record_key: 1 }).update({ observed_at: '2024-02-29 23:59:59.987', at_time: '12:34:56.123' })
      const before = await db(tableName).first()
      await items.alterKnexFields({
        fields: {
          observedAt: { type: 'dateTime', temporalPrecision: 6 },
          atTime: { type: 'time', temporalPrecision: 6 }
        }
      })
      assert.deepEqual(await db(tableName).first(), { ...before, at_time: databaseClient === 'mysql2' ? '12:34:56.123000' : '12:34:56.123' })
      for (const column of (await snapshot()).columns.filter(column => ['observed_at', 'at_time'].includes(column.name))) {
        assert.equal(column.datetimePrecision, 6)
      }
    })
  }

  if (databaseClient === 'better-sqlite3') {
    it('rejects a borrowed rebuild before SQLite can cascade deletion of referencing rows', async () => {
      await db.raw('PRAGMA foreign_keys = ON')
      await db.schema.createTable('schema_children', table => {
        table.increments('id')
        table.integer('parent_id').references('record_key').inTable(tableName).onDelete('CASCADE')
      })
      await db('schema_children').insert({ parent_id: 1 })
      const initial = await snapshot()
      await db.transaction(async trx => {
        await assert.rejects(alterKnexFields(trx, tableName, { structure: { role: { ...role, defaultTo: 'Owner' } } }), /SQLite.*foreign_keys=OFF/)
        assert.equal((await trx('schema_children')).length, 1)
      })
      assert.deepEqual(await snapshot(), initial)
      assert.equal((await db('schema_children')).length, 1)
    })

    it('preserves referencing rows when rebuilding a parent with foreign keys enabled', async () => {
      await db.raw('PRAGMA foreign_keys = ON')
      await db.schema.createTable('schema_children', table => {
        table.increments('id')
        table.integer('parent_id').references('record_key').inTable(tableName).onDelete('CASCADE')
      })
      await db('schema_children').insert({ parent_id: 1 })
      await items.alterKnexFields({ fields: { role: { ...role, defaultTo: 'Owner' } } })
      assert.equal((await db('schema_children')).length, 1)
      assert.equal((await db.raw('PRAGMA foreign_keys'))[0].foreign_keys, 1)
      await assert.rejects(db('schema_children').insert({ parent_id: 999 }))
    })
  }

  if (databaseClient === 'pg') {
    it('alters a schema-qualified table and creates an unqualified constraint name', async () => {
      await alterKnexFields(db, `public.${tableName}`, { structure: { optionalNote: { type: 'string', enum: ['Alpha', 'Beta'], defaultTo: 'Alpha' } } })
      await db(tableName).insert({ optional_note: 'Beta' })
      await assert.rejects(db(tableName).insert({ optional_note: 'Gamma' }))
      assert.ok((await snapshot()).checkConstraints.some(check => check.name === 'schema_records_optional_note_check'))
    })

    it('quotes generated constraint names for mapped columns with spaces', async () => {
      await db.schema.alterTable(tableName, table => table.text('Role Label').checkIn(role.enum))
      await items.alterKnexFields({ fields: { title: { type: 'string', enum: ['Admin', 'Member'], storage: { column: 'Role Label' } } } })
      await db(tableName).insert({ 'Role Label': 'Admin' })
      await assert.rejects(db(tableName).insert({ 'Role Label': 'Owner' }))
      await assert.rejects(db(tableName).insert({ role: 'Admin' }))
    })

    for (const method of ['direct', 'generated']) {
      it(`keeps checks on distinct case-sensitive column names (${method})`, async () => {
        await db.schema.alterTable(tableName, table => table.text('Role').checkIn(role.enum))
        const desired = { ...role, enum: ['Admin', "O'Brien", 'Member'] }
        if (method === 'direct') await items.alterKnexFields({ fields: { role: desired } })
        else {
          const schema = { structure: { ...items.vars.schemaInfo.schemaStructure, role: desired, Role: { type: 'string', enum: role.enum, storage: { column: 'Role' } } } }
          const change = generateKnexMigrationDiff(tableName, await snapshot(), schema, { dialect: databaseClient, idProperty: 'record_key' })
          const migration = {}
          // eslint-disable-next-line no-new-func -- Execute the generated migration in the isolated database.
          new Function('exports', change.migration)(migration)
          await migration.up(db)
        }
        await assert.rejects(db(tableName).insert({ Role: 'Admin' }))
        await db(tableName).insert({ role: 'Admin', Role: 'Owner' })
        assert.equal((await snapshot()).checkConstraints.length, 2)
      })
    }

    it('preserves an unrelated partial index while altering an enum', async () => {
      await db.schema.raw('CREATE INDEX idx_schema_partial ON schema_records (role) WHERE optional_note IS NOT NULL')
      await items.alterKnexFields({ fields: { role: { ...role, enum: ['Admin', "O'Brien", 'Member'] } } })
      await db(tableName).insert({ role: 'Admin' })
      const index = await db('pg_indexes').where({ tablename: tableName, indexname: 'idx_schema_partial' }).first()
      assert.match(index.indexdef, /WHERE \(optional_note IS NOT NULL\)/)
    })
  }
})
