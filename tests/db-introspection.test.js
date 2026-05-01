import { describe, it, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'

import { introspectKnexTableSnapshot } from '../plugins/core/lib/dbIntrospection.js'
import { createKnexTable } from '../plugins/core/lib/dbTablesOperations.js'
import { createBasicApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'

function createMysqlKnexRawDouble ({
  schemaName = 'appdb',
  tableCollation = 'utf8mb4_general_ci',
  columns = [],
  primaryKeyColumns = [],
  indexes = [],
  foreignKeys = [],
  checkConstraints = []
} = {}) {
  const knex = {
    client: {
      config: {
        client: 'mysql2'
      }
    },
    async raw (sql, bindings = []) {
      const normalizedSql = String(sql || '').toLowerCase()

      if (normalizedSql.includes('select database() as schemaname')) {
        return [[{ schemaName }], []]
      }
      if (normalizedSql.includes('from information_schema.tables')) {
        return [[{ tableCollation }], []]
      }
      if (normalizedSql.includes('from information_schema.columns')) {
        return [[...columns], []]
      }
      if (normalizedSql.includes('information_schema.check_constraints')) {
        return [[...checkConstraints], []]
      }
      if (normalizedSql.includes("t.constraint_type = 'primary key'")) {
        return [[...primaryKeyColumns], []]
      }
      if (normalizedSql.includes('from information_schema.statistics')) {
        return [[...indexes], []]
      }
      if (normalizedSql.includes('from information_schema.referential_constraints')) {
        return [[...foreignKeys], []]
      }

      throw new Error(`Unexpected SQL in test double: ${normalizedSql} with bindings ${JSON.stringify(bindings)}`)
    }
  }

  return knex
}

function makeSchemaInfo (tableName, idProperty = 'id') {
  return { tableName, idProperty }
}

function makeTableSchema (structure) {
  return { structure }
}

describe('dbIntrospection.introspectKnexTableSnapshot (sqlite)', () => {
  let db

  beforeEach(() => {
    db = knexLib({
      client: 'better-sqlite3',
      connection: {
        filename: ':memory:'
      },
      useNullAsDefault: true
    })
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('maps SQLite table metadata to a normalized snapshot', async () => {
    await db.raw('PRAGMA foreign_keys = ON')
    await db.raw(`
      CREATE TABLE workspaces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      )
    `)
    await db.raw(`
      CREATE TABLE contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER,
        user_id INTEGER,
        first_name VARCHAR(160) NOT NULL,
        vip BOOLEAN NOT NULL DEFAULT 0,
        balance DECIMAL(10,2),
        updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP,
        settings_json TEXT,
        CONSTRAINT contacts_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON UPDATE CASCADE ON DELETE SET NULL,
        CONSTRAINT settings_json_check CHECK (settings_json IS NULL OR length(settings_json) > 0)
      )
    `)
    await db.raw('CREATE INDEX idx_contacts_first_name ON contacts(first_name)')
    await db.raw('CREATE UNIQUE INDEX uq_contacts_vip ON contacts(vip)')

    const snapshot = await introspectKnexTableSnapshot(db, {
      tableName: 'contacts',
      idColumn: 'id'
    })

    assert.equal(snapshot.dialect, 'sqlite')
    assert.equal(snapshot.schemaName, 'main')
    assert.equal(snapshot.tableName, 'contacts')
    assert.equal(snapshot.idColumn, 'id')
    assert.deepEqual(snapshot.primaryKeyColumns, ['id'])
    assert.equal(snapshot.hasWorkspaceIdColumn, true)
    assert.equal(snapshot.hasUserIdColumn, true)

    const idColumn = snapshot.columns.find((column) => column.name === 'id')
    assert.ok(idColumn)
    assert.equal(idColumn.typeKind, 'integer')
    assert.equal(idColumn.autoIncrement, true)

    const firstName = snapshot.columns.find((column) => column.name === 'first_name')
    assert.ok(firstName)
    assert.equal(firstName.key, 'firstName')
    assert.equal(firstName.typeKind, 'string')
    assert.equal(firstName.maxLength, 160)

    const vip = snapshot.columns.find((column) => column.name === 'vip')
    assert.ok(vip)
    assert.equal(vip.typeKind, 'boolean')
    assert.equal(vip.defaultValue, '0')

    const balance = snapshot.columns.find((column) => column.name === 'balance')
    assert.ok(balance)
    assert.equal(balance.numericPrecision, 10)
    assert.equal(balance.numericScale, 2)

    const updatedAt = snapshot.columns.find((column) => column.name === 'updated_at')
    assert.ok(updatedAt)
    assert.equal(updatedAt.datetimePrecision, 3)

    assert.deepEqual(snapshot.indexes, [
      {
        name: 'idx_contacts_first_name',
        unique: false,
        indexType: '',
        columns: ['first_name']
      },
      {
        name: 'uq_contacts_vip',
        unique: true,
        indexType: '',
        columns: ['vip']
      }
    ])

    assert.deepEqual(snapshot.foreignKeys, [
      {
        name: 'contacts_workspace_id_foreign',
        referencedTableName: 'workspaces',
        updateRule: 'CASCADE',
        deleteRule: 'SET NULL',
        columns: [
          {
            name: 'workspace_id',
            referencedName: 'id'
          }
        ]
      }
    ])

    assert.deepEqual(snapshot.checkConstraints, [
      {
        name: 'settings_json_check',
        clause: 'settings_json IS NULL OR length(settings_json) > 0'
      }
    ])
  })

  it('introspects storage-mapped columns created through table helpers', async () => {
    const schema = makeTableSchema({
      displayName: { type: 'string', required: true, storage: { column: 'display_name' } },
      lastSeenAt: { type: 'dateTime', storage: { column: 'last_seen_at' } }
    })

    await createKnexTable(db, makeSchemaInfo('profiles'), schema)

    const snapshot = await introspectKnexTableSnapshot(db, {
      tableName: 'profiles',
      idColumn: 'id'
    })

    assert.ok(snapshot.columns.some((column) => column.name === 'display_name'))
    assert.ok(snapshot.columns.some((column) => column.name === 'last_seen_at'))
    assert.equal(snapshot.columns.some((column) => column.name === 'displayName'), false)
    assert.equal(snapshot.columns.some((column) => column.name === 'lastSeenAt'), false)

    const displayNameColumn = snapshot.columns.find((column) => column.name === 'display_name')
    assert.ok(displayNameColumn)
    assert.equal(displayNameColumn.key, 'displayName')
    assert.equal(displayNameColumn.typeKind, 'string')

    const lastSeenAtColumn = snapshot.columns.find((column) => column.name === 'last_seen_at')
    assert.ok(lastSeenAtColumn)
    assert.equal(lastSeenAtColumn.key, 'lastSeenAt')
    assert.equal(lastSeenAtColumn.typeKind, 'datetime')
  })

  it('supports custom mapped id columns when the physical table uses that id column', async () => {
    await db.raw(`
      CREATE TABLE books (
        book_id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL
      )
    `)

    const snapshot = await introspectKnexTableSnapshot(db, {
      tableName: 'books',
      idColumn: 'book_id'
    })

    assert.equal(snapshot.idColumn, 'book_id')
    assert.deepEqual(snapshot.primaryKeyColumns, ['book_id'])
    assert.ok(snapshot.columns.some((column) => column.name === 'book_id'))
    assert.equal(snapshot.columns.some((column) => column.name === 'id'), false)

    const bookIdColumn = snapshot.columns.find((column) => column.name === 'book_id')
    assert.ok(bookIdColumn)
    assert.equal(bookIdColumn.typeKind, 'integer')
    assert.equal(bookIdColumn.autoIncrement, true)
    assert.equal(bookIdColumn.nullable, false)
  })

  it('captures multiple SQLite check constraints across inline and table-level definitions', async () => {
    await db.raw(`
      CREATE TABLE quality_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rating INTEGER CHECK (rating >= 1 AND rating <= 5),
        status TEXT CHECK (status IN ('active', 'inactive')),
        score INTEGER,
        CONSTRAINT score_non_negative CHECK (score >= 0)
      )
    `)

    const snapshot = await introspectKnexTableSnapshot(db, {
      tableName: 'quality_checks',
      idColumn: 'id'
    })

    assert.equal(snapshot.checkConstraints.length, 3)
    assert.ok(snapshot.checkConstraints.some((constraint) => (
      constraint.clause === 'rating >= 1 AND rating <= 5'
    )))
    assert.ok(snapshot.checkConstraints.some((constraint) => (
      constraint.clause === "status IN ('active', 'inactive')"
    )))
    assert.ok(snapshot.checkConstraints.some((constraint) => (
      constraint.name === 'score_non_negative' &&
      constraint.clause === 'score >= 0'
    )))
  })

  it('preserves ordered composite indexes from SQLite metadata', async () => {
    await db.raw(`
      CREATE TABLE memberships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL
      )
    `)
    await db.raw('CREATE UNIQUE INDEX uq_memberships_workspace_user ON memberships(workspace_id, user_id)')

    const snapshot = await introspectKnexTableSnapshot(db, {
      tableName: 'memberships',
      idColumn: 'id'
    })

    assert.deepEqual(snapshot.indexes, [
      {
        name: 'uq_memberships_workspace_user',
        unique: true,
        indexType: '',
        columns: ['workspace_id', 'user_id']
      }
    ])
  })

  it('throws for empty, invalid, missing, and unsupported introspection inputs', async () => {
    await assert.rejects(
      () => introspectKnexTableSnapshot(db, { tableName: '' }),
      /requires tableName/
    )

    await assert.rejects(
      () => introspectKnexTableSnapshot(db, { tableName: 'users;drop_table' }),
      /Invalid table name/
    )

    await assert.rejects(
      () => introspectKnexTableSnapshot(db, { tableName: 'missing_table', idColumn: 'id' }),
      /Could not introspect table "missing_table"/
    )

    const unsupportedKnex = {
      client: {
        config: {
          client: 'pg'
        }
      },
      async raw () {
        return []
      }
    }

    await assert.rejects(
      () => introspectKnexTableSnapshot(unsupportedKnex, { tableName: 'users', idColumn: 'id' }),
      /Unsupported knex client/
    )
  })
})

describe('dbIntrospection.introspectKnexTableSnapshot (mysql raw double)', () => {
  it('maps MySQL table metadata to a normalized snapshot', async () => {
    const knex = createMysqlKnexRawDouble({
      columns: [
        {
          columnName: 'id',
          dataType: 'int',
          columnType: 'int unsigned',
          isNullable: 'NO',
          columnDefault: null,
          extra: 'auto_increment',
          numericPrecision: 10,
          numericScale: 0,
          datetimePrecision: null,
          ordinalPosition: 1
        },
        {
          columnName: 'workspace_id',
          dataType: 'int',
          columnType: 'int unsigned',
          isNullable: 'YES',
          columnDefault: 'NULL',
          extra: '',
          numericPrecision: 10,
          numericScale: 0,
          datetimePrecision: null,
          ordinalPosition: 2
        },
        {
          columnName: 'contact_tier',
          dataType: 'enum',
          columnType: "enum('VIP','New')",
          isNullable: 'NO',
          columnDefault: 'VIP',
          extra: '',
          characterSetName: 'utf8mb4',
          collationName: 'utf8mb4_general_ci',
          ordinalPosition: 3
        },
        {
          columnName: 'contact_flags',
          dataType: 'set',
          columnType: "set('featured','archived')",
          isNullable: 'YES',
          columnDefault: null,
          extra: '',
          characterSetName: 'utf8mb4',
          collationName: 'utf8mb4_general_ci',
          ordinalPosition: 4
        },
        {
          columnName: 'balance',
          dataType: 'decimal',
          columnType: 'decimal(10,2)',
          isNullable: 'YES',
          columnDefault: null,
          extra: '',
          numericPrecision: 10,
          numericScale: 2,
          datetimePrecision: null,
          ordinalPosition: 5
        },
        {
          columnName: 'updated_at',
          dataType: 'datetime',
          columnType: 'datetime(3)',
          isNullable: 'NO',
          columnDefault: 'CURRENT_TIMESTAMP',
          extra: '',
          numericPrecision: null,
          numericScale: null,
          datetimePrecision: 3,
          ordinalPosition: 6
        }
      ],
      primaryKeyColumns: [{ columnName: 'id' }],
      indexes: [
        {
          indexName: 'idx_contacts_balance',
          nonUnique: 1,
          indexType: 'BTREE',
          columnName: 'balance',
          seqInIndex: 1
        }
      ],
      foreignKeys: [
        {
          constraintName: 'contacts_workspace_id_foreign',
          columnName: 'workspace_id',
          referencedTableName: 'workspaces',
          referencedColumnName: 'id',
          ordinalPosition: 1,
          updateRule: 'CASCADE',
          deleteRule: 'SET NULL'
        }
      ],
      checkConstraints: [
        {
          constraintName: 'contacts_balance_check',
          checkClause: '(`balance` >= 0)'
        }
      ]
    })

    const snapshot = await introspectKnexTableSnapshot(knex, {
      tableName: 'contacts',
      idColumn: 'id'
    })

    assert.equal(snapshot.dialect, 'mysql2')
    assert.equal(snapshot.tableName, 'contacts')
    assert.equal(snapshot.tableCollation, 'utf8mb4_general_ci')

    const contactTier = snapshot.columns.find((column) => column.name === 'contact_tier')
    assert.ok(contactTier)
    assert.deepEqual(contactTier.enumValues, ['VIP', 'New'])

    const contactFlags = snapshot.columns.find((column) => column.name === 'contact_flags')
    assert.ok(contactFlags)
    assert.deepEqual(contactFlags.setValues, ['featured', 'archived'])

    const balance = snapshot.columns.find((column) => column.name === 'balance')
    assert.ok(balance)
    assert.equal(balance.numericPrecision, 10)
    assert.equal(balance.numericScale, 2)

    const updatedAt = snapshot.columns.find((column) => column.name === 'updated_at')
    assert.ok(updatedAt)
    assert.equal(updatedAt.datetimePrecision, 3)

    assert.deepEqual(snapshot.indexes, [
      {
        name: 'idx_contacts_balance',
        unique: false,
        indexType: 'BTREE',
        columns: ['balance']
      }
    ])

    assert.deepEqual(snapshot.foreignKeys, [
      {
        name: 'contacts_workspace_id_foreign',
        referencedTableName: 'workspaces',
        updateRule: 'CASCADE',
        deleteRule: 'SET NULL',
        columns: [
          {
            name: 'workspace_id',
            referencedName: 'id'
          }
        ]
      }
    ])

    assert.deepEqual(snapshot.checkConstraints, [
      {
        name: 'contacts_balance_check',
        clause: '(`balance` >= 0)'
      }
    ])
  })
})

const describeKnexIntrospection = storageMode.isAnyApi() ? describe.skip : describe

describeKnexIntrospection('RestApiKnexPlugin introspection scope method', () => {
  let db
  let api

  before(async () => {
    db = knexLib({
      client: 'better-sqlite3',
      connection: {
        filename: ':memory:'
      },
      useNullAsDefault: true
    })

    api = await createBasicApi(db, {
      tablePrefix: 'introspect'
    })
  })

  after(async () => {
    await db.destroy()
  })

  it('exposes a table snapshot scope method for table-backed resources', async () => {
    const snapshot = await api.resources.countries.introspectKnexTableSnapshot()

    assert.equal(snapshot.tableName, 'introspect_countries')
    assert.deepEqual(snapshot.primaryKeyColumns, ['id'])
    assert.ok(snapshot.columns.some((column) => column.name === 'name'))
    assert.ok(snapshot.columns.some((column) => column.name === 'code'))
    assert.ok(snapshot.indexes.some((index) => index.unique && index.columns.includes('code')))
  })
})
