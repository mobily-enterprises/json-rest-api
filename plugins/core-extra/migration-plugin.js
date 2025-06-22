import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export class MigrationManager {
  constructor(api, config) {
    this.api = api
    this.config = {
      directory: config.directory || './migrations',
      table: config.table || '_migrations',
      ...config
    }
    this.migrations = []
  }

  async initialize() {
    await this.createMigrationsTable()
    await this.loadMigrations()
  }

  async createMigrationsTable() {
    await this.api.execute('db.createMigrationsTable', { 
      table: this.config.table 
    })
  }

  async loadMigrations() {
    try {
      const migrationDir = path.resolve(this.config.directory)
      const files = await fs.readdir(migrationDir)
      
      this.migrations = []
      for (const file of files.sort()) {
        if (file.endsWith('.js')) {
          const migrationPath = path.join(migrationDir, file)
          const migration = await import(migrationPath)
          this.migrations.push({
            name: file.replace('.js', ''),
            file: file,
            path: migrationPath,
            up: migration.default.up || migration.up,
            down: migration.default.down || migration.down
          })
        }
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        await fs.mkdir(path.resolve(this.config.directory), { recursive: true })
        this.migrations = []
      } else {
        throw error
      }
    }
  }

  async getAppliedMigrations() {
    const result = await this.api.execute('db.query', {
      sql: `SELECT name, batch FROM ${this.config.table} ORDER BY batch ASC, id ASC`,
      params: []
    })
    return result.rows || []
  }

  async getLastBatch() {
    const result = await this.api.execute('db.query', {
      sql: `SELECT MAX(batch) as max_batch FROM ${this.config.table}`,
      params: []
    })
    const rows = result.rows || []
    return rows[0]?.max_batch || 0
  }

  async up(target = null) {
    const applied = await this.getAppliedMigrations()
    const appliedNames = new Set(applied.map(m => m.name))
    const pending = this.migrations.filter(m => !appliedNames.has(m.name))
    
    if (pending.length === 0) {
      console.log('No migrations to run.')
      return []
    }

    const batch = (await this.getLastBatch()) + 1
    const migrated = []

    for (const migration of pending) {

      console.log(`Running migration: ${migration.name}`)
      
      try {
        const self = this
        await this.api.execute('db.transaction', {
          fn: async () => {
            // Create migration context with helper methods
            const migrationContext = {
              async createTable(table, columns) {
                return await self.api.execute('db.createTable', { table, columns })
              },
              async dropTable(table) {
                return await self.api.execute('db.dropTable', { table })
              },
              async addColumn(table, column, type, options) {
                return await self.api.execute('db.addColumn', { table, column, type, options })
              },
              async dropColumn(table, column) {
                return await self.api.execute('db.dropColumn', { table, column })
              },
              async addIndex(table, columns, options) {
                return await self.api.execute('db.addIndex', { table, columns, options })
              },
              async dropIndex(table, name) {
                return await self.api.execute('db.dropIndex', { table, name })
              },
              async execute(sql, params = []) {
                return await self.api.execute('db.query', { sql, params })
              }
            }
            
            await migration.up(self.api, migrationContext)
            
            // Get next ID for migration table (for AlaSQL compatibility)
            const idResult = await self.api.execute('db.query', {
              sql: `SELECT MAX(id) as maxId FROM ${self.config.table}`,
              params: []
            })
            const nextId = (idResult.rows[0]?.maxId || 0) + 1
            
            await self.api.execute('db.query', {
              sql: `INSERT INTO ${self.config.table} (id, name, batch, migrated_at) VALUES (?, ?, ?, ?)`,
              params: [nextId, migration.name, batch, new Date()]
            })
          }
        })
        
        migrated.push(migration.name)
        console.log(`✓ ${migration.name}`)
        
        // If we've reached the target, stop
        if (target && migration.name === target) {
          break
        }
      } catch (error) {
        console.error(`✗ ${migration.name}: ${error.message}`)
        throw error
      }
    }

    return migrated
  }

  async down(steps = 1) {
    const applied = await this.getAppliedMigrations()
    if (applied.length === 0) {
      console.log('No migrations to rollback.')
      return []
    }

    const lastBatch = Math.max(...applied.map(m => m.batch))
    const toRollback = steps === null 
      ? applied.filter(m => m.batch === lastBatch)
      : applied.slice(-steps)

    const rolled = []

    for (const migrationRecord of toRollback.reverse()) {
      const migration = this.migrations.find(m => m.name === migrationRecord.name)
      if (!migration) {
        throw new Error(`Migration file not found: ${migrationRecord.name}`)
      }

      console.log(`Rolling back: ${migration.name}`)
      
      try {
        const self = this
        await this.api.execute('db.transaction', {
          fn: async () => {
            // Create migration context with helper methods
            const migrationContext = {
              async createTable(table, columns) {
                return await self.api.execute('db.createTable', { table, columns })
              },
              async dropTable(table) {
                return await self.api.execute('db.dropTable', { table })
              },
              async addColumn(table, column, type, options) {
                return await self.api.execute('db.addColumn', { table, column, type, options })
              },
              async dropColumn(table, column) {
                return await self.api.execute('db.dropColumn', { table, column })
              },
              async addIndex(table, columns, options) {
                return await self.api.execute('db.addIndex', { table, columns, options })
              },
              async dropIndex(table, name) {
                return await self.api.execute('db.dropIndex', { table, name })
              },
              async execute(sql, params = []) {
                return await self.api.execute('db.query', { sql, params })
              }
            }
            
            await migration.down(self.api, migrationContext)
            await self.api.execute('db.query', {
              sql: `DELETE FROM ${self.config.table} WHERE name = ?`,
              params: [migration.name]
            })
          }
        })
        
        rolled.push(migration.name)
        console.log(`✓ Rolled back ${migration.name}`)
      } catch (error) {
        console.error(`✗ Failed to rollback ${migration.name}: ${error.message}`)
        throw error
      }
    }

    return rolled
  }

  async status() {
    const applied = await this.getAppliedMigrations()
    const appliedNames = new Set(applied.map(m => m.name))
    
    const status = {
      applied: [],
      pending: []
    }

    for (const migration of this.migrations) {
      if (appliedNames.has(migration.name)) {
        const record = applied.find(a => a.name === migration.name)
        status.applied.push({
          name: migration.name,
          batch: record.batch
        })
      } else {
        status.pending.push({
          name: migration.name
        })
      }
    }

    return status
  }

  async reset() {
    const applied = await this.getAppliedMigrations()
    const batches = [...new Set(applied.map(m => m.batch))].sort((a, b) => b - a)
    
    for (const batch of batches) {
      await this.down(null)
    }
  }

  async refresh() {
    await this.reset()
    await this.up()
  }
}

export const MigrationPlugin = {
  install(api, options = {}) {
    const manager = new MigrationManager(api, options)
    
    api.migrations = manager
    
    api.hook('afterConnect', async () => {
      await manager.initialize()
      
      if (options.autoRun && process.env.NODE_ENV !== 'production') {
        console.log('Running pending migrations...')
        await manager.up()
      }
    })
  }
}