import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Api } from '../lib/api.js'
import { MemoryPlugin } from '../plugins/memory.js'
import { MigrationPlugin } from '../plugins/migration-plugin.js'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const testMigrationsDir = path.join(__dirname, 'test-migrations')

// Helper to clean up test migrations
async function cleanupTestMigrations() {
  try {
    await fs.rm(testMigrationsDir, { recursive: true, force: true })
  } catch (error) {
    // Ignore if doesn't exist
  }
}

// Counter for unique timestamps
let migrationCounter = 0

// Helper to create a test migration
async function createTestMigration(name, up, down) {
  await fs.mkdir(testMigrationsDir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)
  const counter = String(migrationCounter++).padStart(3, '0')
  const filename = `${timestamp}${counter}_${name}.js`
  const content = `export default {
    async up(api, db) { ${up} },
    async down(api, db) { ${down} }
  }`
  await fs.writeFile(path.join(testMigrationsDir, filename), content)
  return filename
}

test('Migration plugin basic functionality', async (t) => {
  await cleanupTestMigrations()
  
  const api = new Api()
  api.use(MemoryPlugin)
  api.use(MigrationPlugin, {
    directory: testMigrationsDir,
    table: '_test_migrations'
  })
  
  await api.connect()
  
  // Initially no migrations
  const initialStatus = await api.migrations.status()
  assert.equal(initialStatus.applied.length, 0)
  assert.equal(initialStatus.pending.length, 0)
  
  // Create a migration
  await createTestMigration('create_test_table', 
    `await db.execute('CREATE TABLE test_table (id INT PRIMARY KEY, name VARCHAR(255))')`,
    `await db.dropTable('test_table')`
  )
  
  // Reload migrations
  await api.migrations.loadMigrations()
  
  // Should have one pending migration
  const pendingStatus = await api.migrations.status()
  assert.equal(pendingStatus.applied.length, 0)
  assert.equal(pendingStatus.pending.length, 1)
  
  // Run migration
  const migrated = await api.migrations.up()
  assert.equal(migrated.length, 1)
  
  // Should now be applied
  const appliedStatus = await api.migrations.status()
  assert.equal(appliedStatus.applied.length, 1)
  assert.equal(appliedStatus.pending.length, 0)
  
  // Table should exist
  const result = await api.execute('db.query', {
    sql: 'SELECT * FROM test_table',
    params: []
  })
  assert.equal(Array.isArray(result.rows), true)
  
  // Rollback
  const rolled = await api.migrations.down()
  assert.equal(rolled.length, 1)
  
  // Should be pending again
  const rolledStatus = await api.migrations.status()
  assert.equal(rolledStatus.applied.length, 0)
  assert.equal(rolledStatus.pending.length, 1)
  
  await api.disconnect()
  await cleanupTestMigrations()
})

test('Migration batches and ordering', async (t) => {
  await cleanupTestMigrations()
  
  const api = new Api()
  api.use(MemoryPlugin)
  api.use(MigrationPlugin, {
    directory: testMigrationsDir,
    table: '_test_migrations'
  })
  
  await api.connect()
  
  // Create multiple migrations
  const m1 = await createTestMigration('first', 
    `await db.execute('CREATE TABLE first (id INT)')`,
    `await db.dropTable('first')`
  )
  
  const m2 = await createTestMigration('second', 
    `await db.execute('CREATE TABLE second (id INT)')`,
    `await db.dropTable('second')`
  )
  
  const m3 = await createTestMigration('third', 
    `await db.execute('CREATE TABLE third (id INT)')`,
    `await db.dropTable('third')`
  )
  
  await api.migrations.loadMigrations()
  
  // Run first two migrations
  await api.migrations.up(m2.replace('.js', ''))
  
  let status = await api.migrations.status()
  assert.equal(status.applied.length, 2)
  assert.equal(status.pending.length, 1)
  
  // Run the last one
  await api.migrations.up()
  
  status = await api.migrations.status()
  assert.equal(status.applied.length, 3)
  assert.equal(status.pending.length, 0)
  
  // Check batches
  const applied = await api.migrations.getAppliedMigrations()
  assert.equal(applied[0].batch, 1)
  assert.equal(applied[1].batch, 1)
  assert.equal(applied[2].batch, 2)
  
  // Rollback last batch
  await api.migrations.down()
  
  status = await api.migrations.status()
  assert.equal(status.applied.length, 2)
  assert.equal(status.pending.length, 1)
  
  await api.disconnect()
  await cleanupTestMigrations()
})

test('Migration with schema operations', async (t) => {
  await cleanupTestMigrations()
  
  const api = new Api()
  api.use(MemoryPlugin)
  api.use(MigrationPlugin, {
    directory: testMigrationsDir,
    table: '_test_migrations'
  })
  
  await api.connect()
  
  // Create migration using helper methods
  await createTestMigration('users_migration', `
    await db.execute('CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(255))')
    await db.addColumn('users', 'email', 'VARCHAR(255)', { unique: true })
    await db.addIndex('users', ['name'], { name: 'idx_users_name' })
  `, `
    await db.dropIndex('users', 'idx_users_name')
    await db.dropColumn('users', 'email')
    await db.dropTable('users')
  `)
  
  await api.migrations.loadMigrations()
  
  // Run migration
  await api.migrations.up()
  
  // Insert test data
  await api.execute('db.query', {
    sql: 'INSERT INTO users (id, name, email) VALUES (?, ?, ?)',
    params: [1, 'John', 'john@example.com']
  })
  
  // Query should work
  const result = await api.execute('db.query', {
    sql: 'SELECT * FROM users WHERE email = ?',
    params: ['john@example.com']
  })
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].name, 'John')
  
  // Rollback
  await api.migrations.down()
  
  // Table should not exist
  await assert.rejects(async () => {
    await api.execute('db.query', {
      sql: 'SELECT * FROM users',
      params: []
    })
  })
  
  await api.disconnect()
  await cleanupTestMigrations()
})

test('Migration reset and refresh', async (t) => {
  await cleanupTestMigrations()
  
  const api = new Api()
  api.use(MemoryPlugin)
  api.use(MigrationPlugin, {
    directory: testMigrationsDir,
    table: '_test_migrations'
  })
  
  await api.connect()
  
  // Create migrations
  await createTestMigration('table1', 
    `await db.execute('CREATE TABLE t1 (id INT)')`,
    `await db.dropTable('t1')`
  )
  
  await createTestMigration('table2', 
    `await db.execute('CREATE TABLE t2 (id INT)')`,
    `await db.dropTable('t2')`
  )
  
  await api.migrations.loadMigrations()
  
  // Run all migrations
  await api.migrations.up()
  
  let status = await api.migrations.status()
  assert.equal(status.applied.length, 2)
  
  // Reset (rollback all)
  await api.migrations.reset()
  
  status = await api.migrations.status()
  assert.equal(status.applied.length, 0)
  assert.equal(status.pending.length, 2)
  
  // Refresh (reset + up)
  await api.migrations.refresh()
  
  status = await api.migrations.status()
  assert.equal(status.applied.length, 2)
  assert.equal(status.pending.length, 0)
  
  await api.disconnect()
  await cleanupTestMigrations()
})

test('Migration error handling', async (t) => {
  await cleanupTestMigrations()
  
  const api = new Api()
  api.use(MemoryPlugin)
  api.use(MigrationPlugin, {
    directory: testMigrationsDir,
    table: '_test_migrations'
  })
  
  await api.connect()
  
  // Create migration with error
  await createTestMigration('bad_migration', 
    `throw new Error('Migration failed!')`,
    `await db.dropTable('test')`
  )
  
  await api.migrations.loadMigrations()
  
  // Should throw error
  await assert.rejects(async () => {
    await api.migrations.up()
  }, /Migration failed!/)
  
  // Should not be marked as applied
  const status = await api.migrations.status()
  assert.equal(status.applied.length, 0)
  assert.equal(status.pending.length, 1)
  
  await api.disconnect()
  await cleanupTestMigrations()
})