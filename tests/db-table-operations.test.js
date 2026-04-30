import { describe, it, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import { Api } from 'hooked-api'
import { RestApiPlugin, RestApiKnexPlugin } from '../index.js'
import {
  createKnexTable,
  addKnexFields,
  alterKnexFields,
  generateKnexMigration,
  generateKnexMigrationDiff
} from '../plugins/core/lib/dbTablesOperations.js'
import { introspectKnexTableSnapshot } from '../plugins/core/lib/dbIntrospection.js'

function makeSchemaInfo (tableName, idProperty = 'id') {
  return { tableName, idProperty }
}

function makeTableSchema (structure, metadata = {}) {
  return { structure, ...metadata }
}

let db

describe('dbTablesOperations.createKnexTable', () => {
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

  it('creates a simple table with string fields', async () => {
    const schema = makeTableSchema({
      name: { type: 'string', required: true, maxLength: 100 },
      email: { type: 'string', unique: true },
      bio: { type: 'string', nullable: true }
    })

    await createKnexTable(db, makeSchemaInfo('users'), schema)

    const exists = await db.schema.hasTable('users')
    assert.equal(exists, true)

    const info = await db('users').columnInfo()
    assert.ok(info.id)
    assert.ok(info.name)
    assert.ok(info.email)
    assert.ok(info.bio)

    await db('users').insert({
      name: 'Test User',
      email: 'test@example.com',
      bio: null
    })

    const users = await db('users').select()
    assert.equal(users.length, 1)
    assert.equal(users[0].name, 'Test User')
  })

  it('handles number fields with precision and defaults', async () => {
    const schema = makeTableSchema({
      price: { type: 'number', precision: 10, scale: 2 },
      quantity: { type: 'number', defaultTo: 0 },
      rating: { type: 'number', nullable: true }
    })

    await createKnexTable(db, makeSchemaInfo('products'), schema)

    await db('products').insert({
      price: 99.99,
      rating: 4.5
    })

    const products = await db('products').select()
    assert.equal(products[0].price, 99.99)
    assert.equal(products[0].quantity, 0)
    assert.equal(products[0].rating, 4.5)
  })

  it('adds timestamps when requested', async () => {
    const schema = makeTableSchema({
      title: { type: 'string' }
    })

    await createKnexTable(db, makeSchemaInfo('posts'), schema, {
      timestamps: true
    })

    const info = await db('posts').columnInfo()
    assert.ok(info.created_at)
    assert.ok(info.updated_at)
  })

  it('handles foreign key references', async () => {
    const userSchema = makeTableSchema({
      username: { type: 'string', unique: true }
    })
    await createKnexTable(db, makeSchemaInfo('users'), userSchema)

    const postSchema = makeTableSchema({
      title: { type: 'string', required: true },
      userId: {
        type: 'id',
        required: true,
        references: { table: 'users', onDelete: 'CASCADE' }
      }
    })
    await createKnexTable(db, makeSchemaInfo('posts'), postSchema)

    await db('users').insert({ username: 'testuser' })
    const user = await db('users').where('username', 'testuser').first()
    await db('posts').insert({ title: 'Test Post', user_id: user.id })

    const posts = await db('posts')
      .join('users', 'posts.user_id', 'users.id')
      .select('posts.title', 'users.username')

    assert.equal(posts.length, 1)
    assert.equal(posts[0].title, 'Test Post')
    assert.equal(posts[0].username, 'testuser')
  })

  it('respects a primary key defined in the schema', async () => {
    const schema = makeTableSchema({
      isbn: { type: 'string', primary: true, maxLength: 13 },
      title: { type: 'string', required: true }
    })

    await createKnexTable(db, makeSchemaInfo('books'), schema, {
      autoIncrement: false
    })

    const info = await db('books').columnInfo()
    assert.ok(!info.id)
    assert.ok(info.isbn)

    await db('books').insert({
      isbn: '9781234567890',
      title: 'Test Book'
    })

    const books = await db('books').select()
    assert.equal(books[0].isbn, '9781234567890')
  })

  it('enforces unique constraints', async () => {
    const schema = makeTableSchema({
      email: { type: 'string', unique: true },
      username: { type: 'string', unique: true }
    })

    await createKnexTable(db, makeSchemaInfo('accounts'), schema)

    await db('accounts').insert({
      email: 'test@example.com',
      username: 'testuser'
    })

    await assert.rejects(async () => {
      await db('accounts').insert({
        email: 'test@example.com',
        username: 'otheruser'
      })
    })
  })

  it('defaults storage columns to snake_case and keeps per-field overrides', async () => {
    const schema = makeTableSchema({
      displayName: { type: 'string', required: true },
      lastSeenAt: { type: 'dateTime' },
      externalRef: { type: 'string', storage: { column: 'legacy_ref' } }
    })

    await createKnexTable(db, makeSchemaInfo('mapped_profiles'), schema)

    const info = await db('mapped_profiles').columnInfo()
    assert.ok(info.id)
    assert.ok(info.display_name)
    assert.ok(info.last_seen_at)
    assert.ok(info.legacy_ref)
    assert.equal(info.displayName, undefined)
    assert.equal(info.external_ref, undefined)
  })

  it('supports logical id fields mapped to custom storage columns', async () => {
    const schema = makeTableSchema({
      id: { type: 'id', primary: true, storage: { column: 'book_id' } },
      title: { type: 'string', required: true }
    })

    await createKnexTable(db, makeSchemaInfo('books', 'book_id'), schema)

    const info = await db('books').columnInfo()
    assert.ok(info.book_id)
    assert.equal(info.id, undefined)

    await db('books').insert({
      book_id: 101,
      title: 'Mapped ID Book'
    })

    const books = await db('books').select()
    assert.equal(books.length, 1)
    assert.equal(books[0].book_id, 101)
  })

  it('supports named composite indexes, foreign keys, checks, and enum columns', async () => {
    await db.raw('PRAGMA foreign_keys = ON')
    await db.raw(`
      CREATE TABLE workspace_users (
        workspace_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, user_id)
      )
    `)

    const schema = makeTableSchema({
      workspaceId: { type: 'id', required: true },
      userId: { type: 'id', required: true },
      role: { type: 'string', enum: ['owner', 'member'], required: true, defaultTo: 'member' },
      noteCount: { type: 'number', defaultTo: 0 }
    }, {
      indexes: [
        {
          name: 'uq_memberships_workspace_user',
          unique: true,
          columns: ['workspaceId', 'userId']
        }
      ],
      foreignKeys: [
        {
          name: 'fk_memberships_workspace_user',
          columns: ['workspaceId', 'userId'],
          referencedTableName: 'workspace_users',
          referencedColumns: ['workspace_id', 'user_id'],
          deleteRule: 'CASCADE',
          updateRule: 'RESTRICT'
        }
      ],
      checkConstraints: [
        {
          name: 'chk_memberships_note_count_non_negative',
          clause: 'note_count >= 0'
        }
      ]
    })

    await createKnexTable(db, makeSchemaInfo('memberships'), schema)

    const snapshot = await introspectKnexTableSnapshot(db, {
      tableName: 'memberships',
      idColumn: 'id'
    })

    const membershipIndex = snapshot.indexes.find((index) => index.name === 'uq_memberships_workspace_user')
    assert.ok(membershipIndex)
    assert.equal(membershipIndex.unique, true)
    assert.deepEqual(membershipIndex.columns, ['workspace_id', 'user_id'])

    const membershipForeignKey = snapshot.foreignKeys.find((foreignKey) => foreignKey.name === 'fk_memberships_workspace_user')
    assert.ok(membershipForeignKey)
    assert.equal(membershipForeignKey.referencedTableName, 'workspace_users')
    assert.equal(membershipForeignKey.deleteRule, 'CASCADE')
    assert.equal(membershipForeignKey.updateRule, 'RESTRICT')
    assert.deepEqual(
      membershipForeignKey.columns.map((entry) => [entry.name, entry.referencedName]),
      [['workspace_id', 'workspace_id'], ['user_id', 'user_id']]
    )

    const membershipCheck = snapshot.checkConstraints.find((constraint) => constraint.name === 'chk_memberships_note_count_non_negative')
    assert.ok(membershipCheck)
    assert.equal(membershipCheck.clause, 'note_count >= 0')

    const roleColumn = snapshot.columns.find((column) => column.name === 'role')
    assert.ok(roleColumn)
    assert.deepEqual(roleColumn.enumValues, ['owner', 'member'])
  })
})

describe('dbTablesOperations.generateKnexMigration', () => {
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

  it('generates executable migrations', async () => {
    const schema = makeTableSchema({
      name: { type: 'string', required: true },
      age: { type: 'number', min: 0 },
      email: { type: 'string', unique: true }
    })

    const migration = generateKnexMigration('users', schema)
    const migrationModule = {}
    const migrationCode = migration
      .replace(/exports\.up/g, 'migrationModule.up')
      .replace(/exports\.down/g, 'migrationModule.down')

    new Function('migrationModule', migrationCode)(migrationModule)

    await migrationModule.up(db)

    const exists = await db.schema.hasTable('users')
    assert.equal(exists, true)

    await db('users').insert({
      name: 'Test User',
      age: 25,
      email: 'test@example.com'
    })

    await migrationModule.down(db)

    const existsAfter = await db.schema.hasTable('users')
    assert.equal(existsAfter, false)
  })

  it('includes the expected schema features in generated migrations', () => {
    const schema = makeTableSchema({
      id: { type: 'id', primary: true },
      title: { type: 'string', required: true, maxLength: 200 },
      price: { type: 'number', precision: 10, scale: 2 },
      inStock: { type: 'boolean', defaultTo: true },
      categoryId: {
        type: 'id',
        nullable: true,
        references: { table: 'categories', onDelete: 'SET NULL' }
      },
      tags: { type: 'array', defaultTo: [] }
    })

    const migration = generateKnexMigration('products', schema, {
      timestamps: true
    })

    assert.ok(migration.includes("table.integer('id').unsigned().primary()"))
    assert.ok(migration.includes("table.string('title', 200).notNullable()"))
    assert.ok(migration.includes("table.decimal('price', 10, 2)"))
    assert.ok(migration.includes(".defaultTo(true)"))
    assert.ok(migration.includes("table.foreign(['category_id'], 'products_category_id_foreign').references(['id']).inTable('categories').onDelete('SET NULL')"))
    assert.ok(migration.includes('table.timestamps(true, true)'))
  })

  it('uses default snake_case columns in generated migrations and keeps per-field overrides', () => {
    const schema = makeTableSchema({
      displayName: { type: 'string', required: true },
      loginCount: { type: 'number', defaultTo: 0 },
      externalRef: { type: 'string', storage: { column: 'legacy_ref' } }
    })

    const migration = generateKnexMigration('mapped_profiles', schema)

    assert.ok(migration.includes("table.string('display_name').notNullable()"))
    assert.ok(migration.includes("table.float('login_count').defaultTo(0)"))
    assert.ok(migration.includes("table.string('legacy_ref')"))
    assert.ok(!migration.includes("table.string('displayName')"))
  })

  it('supports mapped logical id fields in generated migrations', () => {
    const schema = makeTableSchema({
      id: { type: 'id', primary: true, storage: { column: 'book_id' } },
      title: { type: 'string', required: true }
    })

    const migration = generateKnexMigration('books', schema)

    assert.ok(migration.includes("table.integer('book_id').unsigned().primary()"))
    assert.ok(migration.includes("table.string('title').notNullable()"))
    assert.equal((migration.match(/book_id/g) || []).length, 1)
  })

  it('includes named composite indexes, foreign keys, checks, enum, and set columns in generated migrations', () => {
    const schema = makeTableSchema({
      workspaceId: { type: 'id', required: true },
      userId: { type: 'id', required: true },
      role: { type: 'string', enum: ['owner', 'member'], required: true, defaultTo: 'member' },
      flags: { type: 'string', setValues: ['featured', 'archived'] },
      noteCount: { type: 'number', defaultTo: 0 }
    }, {
      indexes: [
        {
          name: 'uq_memberships_workspace_user',
          unique: true,
          columns: ['workspaceId', 'userId']
        }
      ],
      foreignKeys: [
        {
          name: 'fk_memberships_workspace_user',
          columns: ['workspaceId', 'userId'],
          referencedTableName: 'workspace_users',
          referencedColumns: ['workspace_id', 'user_id'],
          deleteRule: 'CASCADE',
          updateRule: 'RESTRICT'
        }
      ],
      checkConstraints: [
        {
          name: 'chk_memberships_note_count_non_negative',
          clause: 'note_count >= 0'
        }
      ]
    })

    const migration = generateKnexMigration('memberships', schema, {
      dialect: 'mysql2'
    })

    assert.ok(migration.includes("table.enu('role', ['owner', 'member']).notNullable().defaultTo('member')"))
    assert.ok(migration.includes("table.specificType('flags', 'set(\\'featured\\', \\'archived\\')')"))
    assert.ok(migration.includes("table.unique(['workspace_id', 'user_id'], 'uq_memberships_workspace_user')"))
    assert.ok(migration.includes("table.foreign(['workspace_id', 'user_id'], 'fk_memberships_workspace_user').references(['workspace_id', 'user_id']).inTable('workspace_users').onDelete('CASCADE').onUpdate('RESTRICT')"))
    assert.ok(migration.includes("table.check('note_count >= 0', [], 'chk_memberships_note_count_non_negative')"))
  })

  it('includes indexType for non-unique indexes in generated migrations', () => {
    const schema = makeTableSchema({
      body: { type: 'string' }
    }, {
      indexes: [
        {
          name: 'idx_articles_body_fulltext',
          columns: ['body'],
          indexType: 'FULLTEXT'
        }
      ]
    })

    const migration = generateKnexMigration('articles', schema)

    assert.ok(migration.includes("table.index(['body'], 'idx_articles_body_fulltext', { \"indexType\": 'FULLTEXT' })"))
  })

  it('rejects indexType on unique index metadata', () => {
    const schema = makeTableSchema({
      email: { type: 'string' }
    }, {
      indexes: [
        {
          name: 'uq_accounts_email',
          unique: true,
          columns: ['email'],
          indexType: 'BTREE'
        }
      ]
    })

    assert.throws(
      () => generateKnexMigration('accounts', schema),
      /cannot define indexType/i
    )
  })
})

describe('dbTablesOperations.generateKnexMigrationDiff', () => {
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

  it('generates additive alter migrations from a live snapshot', async () => {
    await db.raw('PRAGMA foreign_keys = ON')
    await db.raw(`
      CREATE TABLE workspace_users (
        workspace_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, user_id)
      )
    `)
    await db.raw(`
      CREATE TABLE memberships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL
      )
    `)

    const currentSnapshot = await introspectKnexTableSnapshot(db, {
      tableName: 'memberships',
      idColumn: 'id'
    })
    const desiredSchema = makeTableSchema({
      workspaceId: { type: 'id', required: true },
      userId: { type: 'id', required: true },
      role: { type: 'string', enum: ['owner', 'member'], required: true, defaultTo: 'member' },
      noteCount: { type: 'number', defaultTo: 0 }
    }, {
      indexes: [
        {
          name: 'uq_memberships_workspace_user',
          unique: true,
          columns: ['workspaceId', 'userId']
        }
      ],
      foreignKeys: [
        {
          name: 'fk_memberships_workspace_user',
          columns: ['workspaceId', 'userId'],
          referencedTableName: 'workspace_users',
          referencedColumns: ['workspace_id', 'user_id'],
          deleteRule: 'CASCADE',
          updateRule: 'RESTRICT'
        }
      ]
    })

    const diff = generateKnexMigrationDiff('memberships', currentSnapshot, desiredSchema, {
      dialect: 'better-sqlite3'
    })

    assert.deepEqual(diff.warnings, [])
    assert.equal(Object.hasOwn(diff.plan, 'dropCheckConstraints'), false)
    assert.deepEqual(diff.plan.addColumns.map((column) => column.name), ['note_count', 'role'])
    assert.deepEqual(diff.plan.addIndexes.map((index) => index.name), ['uq_memberships_workspace_user'])
    assert.deepEqual(diff.plan.addForeignKeys.map((foreignKey) => foreignKey.name), ['fk_memberships_workspace_user'])
    assert.ok(diff.migration.includes("table.float('note_count').defaultTo(0)"))
    assert.ok(diff.migration.includes("table.enu('role', ['owner', 'member']).notNullable().defaultTo('member')"))

    const migrationModule = {}
    new Function('migrationModule', diff.migration
      .replace(/exports\.up/g, 'migrationModule.up')
      .replace(/exports\.down/g, 'migrationModule.down'))(migrationModule)

    await migrationModule.up(db)

    const afterSnapshot = await introspectKnexTableSnapshot(db, {
      tableName: 'memberships',
      idColumn: 'id'
    })

    const roleColumn = afterSnapshot.columns.find((column) => column.name === 'role')
    assert.ok(roleColumn)
    assert.deepEqual(roleColumn.enumValues, ['owner', 'member'])
    assert.equal(roleColumn.defaultValue, 'member')
    assert.ok(afterSnapshot.columns.some((column) => column.name === 'note_count'))
    assert.ok(afterSnapshot.indexes.some((index) => index.name === 'uq_memberships_workspace_user'))
    assert.ok(afterSnapshot.foreignKeys.some((foreignKey) => foreignKey.name === 'fk_memberships_workspace_user'))

    const secondDiff = generateKnexMigrationDiff('memberships', afterSnapshot, desiredSchema, {
      dialect: 'better-sqlite3'
    })

    assert.deepEqual(secondDiff.warnings, [])
    assert.equal(secondDiff.plan.addColumns.length, 0)
    assert.equal(secondDiff.plan.alterColumns.length, 0)
    assert.equal(secondDiff.plan.dropColumns.length, 0)
    assert.equal(secondDiff.plan.addIndexes.length, 0)
    assert.equal(secondDiff.plan.dropIndexes.length, 0)
    assert.equal(secondDiff.plan.addForeignKeys.length, 0)
    assert.equal(secondDiff.plan.dropForeignKeys.length, 0)
  })

  it('recreates indexes when indexType changes', async () => {
    await db.raw(`
      CREATE TABLE articles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        body TEXT
      )
    `)

    const currentSnapshot = await introspectKnexTableSnapshot(db, {
      tableName: 'articles',
      idColumn: 'id'
    })
    currentSnapshot.indexes.push({
      name: 'idx_articles_body',
      unique: false,
      columns: ['body'],
      indexType: ''
    })

    const desiredSchema = makeTableSchema({
      body: { type: 'string' }
    }, {
      indexes: [
        {
          name: 'idx_articles_body',
          columns: ['body'],
          indexType: 'FULLTEXT'
        }
      ]
    })

    const diff = generateKnexMigrationDiff('articles', currentSnapshot, desiredSchema, {
      dialect: 'mysql2'
    })

    assert.deepEqual(diff.plan.addIndexes.map((index) => index.name), ['idx_articles_body'])
    assert.deepEqual(diff.plan.dropIndexes.map((index) => index.name), ['idx_articles_body'])
    assert.ok(diff.migration.includes("table.dropIndex(['body'], 'idx_articles_body');"))
    assert.ok(diff.migration.includes("table.index(['body'], 'idx_articles_body', { \"indexType\": 'FULLTEXT' });"))
  })

  it('warns about destructive column changes and skipped drops by default', async () => {
    await db.raw(`
      CREATE TABLE documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title VARCHAR(255),
        legacy_code TEXT
      )
    `)

    const currentSnapshot = await introspectKnexTableSnapshot(db, {
      tableName: 'documents',
      idColumn: 'id'
    })
    const desiredSchema = makeTableSchema({
      title: { type: 'string', required: true, maxLength: 50 }
    }, {
      checkConstraints: [
        {
          name: 'chk_documents_title_non_empty',
          clause: 'length(title) > 0'
        }
      ]
    })

    const diff = generateKnexMigrationDiff('documents', currentSnapshot, desiredSchema, {
      dialect: 'sqlite'
    })

    assert.ok(diff.warnings.some((warning) => warning.includes("Column 'legacy_code' exists in the live table but not in the desired schema.")))
    assert.ok(diff.warnings.some((warning) => warning.includes("Column 'title' changes from nullable to not-null")))
    assert.ok(diff.warnings.some((warning) => warning.includes("Column 'title' reduces maxLength from 255 to 50")))
    assert.ok(diff.warnings.some((warning) => warning.includes("Skipping check constraint 'chk_documents_title_non_empty'")))
    assert.equal(diff.plan.dropColumns.length, 0)
    assert.deepEqual(diff.plan.alterColumns.map((column) => column.name), ['title'])
  })

  it('warns when setValues are diffed on a non-MySQL dialect', async () => {
    await db.raw(`
      CREATE TABLE articles (
        id INTEGER PRIMARY KEY AUTOINCREMENT
      )
    `)

    const currentSnapshot = await introspectKnexTableSnapshot(db, {
      tableName: 'articles',
      idColumn: 'id'
    })
    const desiredSchema = makeTableSchema({
      flags: { type: 'string', setValues: ['featured', 'archived'] }
    })

    const diff = generateKnexMigrationDiff('articles', currentSnapshot, desiredSchema, {
      dialect: 'sqlite'
    })

    assert.ok(diff.warnings.some((warning) => warning.includes("Skipping setValues column 'flags'")))
    assert.equal(diff.plan.addColumns.length, 0)
  })
})

describe('dbTablesOperations field-only helpers', () => {
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

  it('rejects top-level metadata in addKnexFields', async () => {
    await assert.rejects(
      () => addKnexFields(db, 'accounts', makeTableSchema({
        email: { type: 'string' }
      }, {
        indexes: [{ name: 'idx_accounts_email', columns: ['email'] }]
      })),
      /does not accept top-level indexes/i
    )
  })

  it('rejects top-level metadata in alterKnexFields', async () => {
    await assert.rejects(
      () => alterKnexFields(db, 'accounts', makeTableSchema({
        email: { type: 'string' }
      }, {
        checkConstraints: [{ name: 'chk_accounts_email', clause: "email <> ''" }]
      })),
      /does not accept top-level checkConstraints/i
    )
  })
})

describe('RestApiKnexPlugin migration scope methods', () => {
  let api

  before(async () => {
    db = knexLib({
      client: 'better-sqlite3',
      connection: {
        filename: ':memory:'
      },
      useNullAsDefault: true
    })

    api = new Api({
      name: 'migration-scope-test-api',
      log: { level: 'warn' }
    })

    await api.use(RestApiPlugin, {
      simplifiedApi: false,
      simplifiedTransport: false
    })
    await api.use(RestApiKnexPlugin, { knex: db })

    await api.addResource('memberships', {
      schema: {
        id: { type: 'id' },
        workspaceId: { type: 'id', required: true },
        userId: { type: 'id', required: true },
        role: { type: 'string', enum: ['owner', 'member'], required: true, defaultTo: 'member' }
      },
      indexes: [
        {
          name: 'uq_scope_memberships_workspace_user',
          unique: true,
          columns: ['workspaceId', 'userId']
        }
      ],
      checkConstraints: [
        {
          name: 'chk_scope_memberships_workspace_positive',
          clause: 'workspace_id > 0'
        }
      ],
      tableName: 'scope_memberships'
    })

    await api.resources.memberships.createKnexTable()
  })

  after(async () => {
    await db.destroy()
  })

  it('exposes create and diff migration helpers through table-backed resource scopes', async () => {
    const createMigration = await api.resources.memberships.generateKnexMigration()

    assert.ok(createMigration.includes("table.unique(['workspace_id', 'user_id'], 'uq_scope_memberships_workspace_user')"))
    assert.ok(createMigration.includes("table.check('workspace_id > 0', [], 'chk_scope_memberships_workspace_positive')"))

    const diff = await api.resources.memberships.generateKnexMigrationDiff()

    assert.deepEqual(diff.warnings, [])
    assert.equal(diff.plan.addColumns.length, 0)
    assert.equal(diff.plan.alterColumns.length, 0)
    assert.equal(diff.plan.addIndexes.length, 0)
    assert.equal(diff.plan.addCheckConstraints.length, 0)
  })
})
