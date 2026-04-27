import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import {
  createKnexTable,
  generateKnexMigration
} from '../plugins/core/lib/dbTablesOperations.js'

function makeSchemaInfo (tableName, idProperty = 'id') {
  return { tableName, idProperty }
}

function makeTableSchema (structure) {
  return { structure }
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
    await db('posts').insert({ title: 'Test Post', userId: user.id })

    const posts = await db('posts')
      .join('users', 'posts.userId', 'users.id')
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

  it('uses storage column overrides when creating tables', async () => {
    const schema = makeTableSchema({
      displayName: { type: 'string', required: true, storage: { column: 'display_name' } },
      lastSeenAt: { type: 'dateTime', storage: { column: 'last_seen_at' } }
    })

    await createKnexTable(db, makeSchemaInfo('mapped_profiles'), schema)

    const info = await db('mapped_profiles').columnInfo()
    assert.ok(info.id)
    assert.ok(info.display_name)
    assert.ok(info.last_seen_at)
    assert.equal(info.displayName, undefined)
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
    assert.ok(migration.includes(".references('id').inTable('categories').onDelete('SET NULL')"))
    assert.ok(migration.includes('table.timestamps(true, true)'))
  })

  it('uses storage column overrides in generated migrations', () => {
    const schema = makeTableSchema({
      displayName: { type: 'string', required: true, storage: { column: 'display_name' } },
      loginCount: { type: 'number', defaultTo: 0, storage: { column: 'login_count' } }
    })

    const migration = generateKnexMigration('mapped_profiles', schema)

    assert.ok(migration.includes("table.string('display_name').notNullable()"))
    assert.ok(migration.includes("table.float('login_count').defaultTo(0)"))
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
})
